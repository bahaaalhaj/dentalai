import type { Pool, PoolClient } from 'pg';
import { ImagingHistorySchema } from '@dentalai/contracts';
import type { AccessContext } from '../access/access.repository.js';
import { DomainError } from '../../errors/domain-errors.js';
import type { PrivateStorage } from './storage.js';
import type { InferenceClient } from './inference.js';
import { checksum } from './image-validation.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class ImagingCore {
  constructor(
    protected readonly pool: Pool,
    protected readonly storage?: PrivateStorage,
    protected readonly inference?: InferenceClient,
  ) {}
  protected async tx<T>(
    context: AccessContext,
    patientId: string | undefined,
    operation: (db: PoolClient, clinic: string, member: string) => Promise<T>,
  ): Promise<T> {
    const m = context.membership;
    if (!m) throw new DomainError('ACCESS_DENIED', 'Select a clinic first.', 403);
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT saas_lock($1)', [m.clinicId]);
      const access = await db.query(
        `SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL
        JOIN clinics c ON c.id=m.clinic_id AND c.active JOIN auth_sessions s ON s.id=$3 AND s.user_id=u.id AND s.expires_at>now()
        JOIN membership_roles mr ON mr.clinic_id=m.clinic_id AND mr.membership_id=m.id
        JOIN roles r ON r.clinic_id=mr.clinic_id AND r.id=mr.role_id
        WHERE m.id=$1 AND m.clinic_id=$2 AND m.user_id=$4 AND m.status='active' AND r.key='dentist'
        AND (s.active_membership_id IS NULL OR s.active_membership_id=m.id)
        FOR SHARE OF m,u,c,s,mr,r`,
        [m.id, m.clinicId, context.sessionId, context.userId],
      );
      if (!access.rowCount)
        throw new DomainError(
          'ACCESS_DENIED',
          'Only an authorized clinic dentist can access imaging.',
          403,
        );
      const provider = await db.query(
        `SELECT p.id FROM providers p JOIN staff s ON s.clinic_id=p.clinic_id AND s.id=p.staff_id WHERE p.clinic_id=$1 AND s.membership_id=$2 AND p.active AND s.active FOR SHARE OF p,s`,
        [m.clinicId, m.id],
      );
      if (!provider.rowCount)
        throw new DomainError(
          'ACCESS_DENIED',
          'An active clinic dentist provider is required.',
          403,
        );
      if (
        patientId &&
        !(
          await db.query('SELECT id FROM patients WHERE clinic_id=$1 AND id=$2 FOR SHARE', [
            m.clinicId,
            patientId,
          ])
        ).rowCount
      )
        throw new DomainError('IMAGE_NOT_FOUND', 'Clinical image not found.', 404);
      const result = await operation(db, m.clinicId, m.id);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
  protected audit(
    db: PoolClient,
    context: AccessContext,
    clinic: string,
    action: string,
    id: string,
    data: object,
  ) {
    return db.query(
      `INSERT INTO audit_events(clinic_id,actor_user_id,action,entity_type,entity_id,request_id,data) VALUES($1,$2,$3,'clinical_image',$4,$5,$6)`,
      [clinic, context.userId, action, id, context.requestId, JSON.stringify(data)],
    );
  }
  async history(context: AccessContext, patient: string) {
    return this.tx(context, patient, async (db, clinic) => {
      const images = await db.query(
        `SELECT v.id,v.study_id AS "studyId",v.version,v.width,v.height,f.size_bytes::integer AS size,f.content_type AS "contentType",f.sha256,v.created_at::text AS "createdAt"
        FROM clinical_image_versions v JOIN files f ON f.clinic_id=v.clinic_id AND f.id=v.file_id WHERE v.clinic_id=$1 AND v.patient_id=$2 AND f.status='available' ORDER BY v.created_at,v.version`,
        [clinic, patient],
      );
      const runs = await db.query(
        `SELECT r.id,r.image_id AS "imageId",r.status,coalesce(rev.decision,'draft') AS "reviewState",
        CASE WHEN r.result IS NULL THEN NULL ELSE
         (r.result-'rawPredictions'-'rawDetections'-'detectionCount') || jsonb_build_object('responseVersion','detections-v2','detections',
          CASE WHEN r.result->>'responseVersion'='detections-v2' THEN
           coalesce((SELECT jsonb_agg(jsonb_build_object('classId',d.class_id,'score',d.score,'box',jsonb_build_array(d.x,d.y,d.width,d.height)) ORDER BY d.ordinal)
            FROM image_model_detections d WHERE d.clinic_id=r.clinic_id AND d.run_id=r.id),'[]'::jsonb)
          ELSE r.result->'detections' END) END AS result,
        r.error_code AS "errorCode",r.created_at::text AS "createdAt"
        FROM image_inference_runs r JOIN clinical_image_versions v ON v.clinic_id=r.clinic_id AND v.id=r.image_id
        LEFT JOIN image_clinician_reviews rev ON rev.clinic_id=r.clinic_id AND rev.run_id=r.id WHERE r.clinic_id=$1 AND v.patient_id=$2 ORDER BY r.created_at`,
        [clinic, patient],
      );
      return ImagingHistorySchema.parse({ images: images.rows, analyses: runs.rows });
    });
  }
  async capabilities(context: AccessContext) {
    return this.tx(context, undefined, async () => ({
      storageConfigured: !!this.storage,
      inferenceConfigured: !!this.inference,
      clinicallyValidated: false as const,
    }));
  }
  protected async locate(context: AccessContext, id: string) {
    return this.tx(context, undefined, async (db, clinic) => {
      const row = await db.query<{
        object_key: string;
        sha256: string;
        content_type: string;
        size_bytes: string;
        patient_id: string;
        width: number;
        height: number;
      }>(
        `SELECT f.object_key,f.sha256,f.content_type,f.size_bytes::text,v.patient_id,v.width,v.height FROM clinical_image_versions v JOIN files f ON f.clinic_id=v.clinic_id AND f.id=v.file_id WHERE v.clinic_id=$1 AND v.id=$2 AND f.status='available'`,
        [clinic, id],
      );
      const result = row.rows[0];
      if (!result) throw new DomainError('IMAGE_NOT_FOUND', 'Clinical image not found.', 404);
      return result;
    });
  }
  async content(context: AccessContext, id: string) {
    const file = await this.locate(context, id);
    if (!this.storage)
      throw new DomainError('STORAGE_UNAVAILABLE', 'Private image storage is unavailable.', 503);
    try {
      const data = await this.storage.get(file.object_key);
      if (data.length !== Number(file.size_bytes) || checksum(data) !== file.sha256)
        throw new Error('Object integrity mismatch');
      // Revoked memberships cannot receive a response after an object download.
      await this.tx(context, file.patient_id, async () => undefined);
      return { data, contentType: file.content_type };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('STORAGE_UNAVAILABLE', 'Private image storage is unavailable.', 503);
    }
  }
}
