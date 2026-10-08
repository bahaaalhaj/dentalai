import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ImagingHistorySchema, type InferenceResult } from '@dentalai/contracts';
import type { AccessContext } from '../access/access.repository.js';
import { DomainError } from '../../errors/domain-errors.js';
import type { PrivateStorage } from './storage.js';
import type { InferenceClient } from './inference.js';
import { checksum, validateImage } from './image-validation.js';

export class ImagingRepository {
  constructor(
    private readonly pool: Pool,
    private readonly storage?: PrivateStorage,
    private readonly inference?: InferenceClient,
  ) {}
  private async tx<T>(
    context: AccessContext,
    patientId: string | undefined,
    operation: (db: PoolClient, clinic: string, member: string) => Promise<T>,
  ): Promise<T> {
    const m = context.membership;
    if (!m) throw new DomainError('ACCESS_DENIED', 'Select a clinic first.', 403);
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
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
  private audit(
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
        `SELECT r.id,r.image_id AS "imageId",r.status,coalesce(rev.decision,'draft') AS "reviewState",r.result,r.error_code AS "errorCode",r.created_at::text AS "createdAt"
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
  async upload(
    context: AccessContext,
    patient: string,
    data: Buffer,
    mime: string,
    reason: string,
    existingStudy?: string,
  ) {
    // Authorization before expensive decoding; rechecked when reserving and publishing.
    await this.tx(context, patient, async () => undefined);
    if (!this.storage)
      throw new DomainError(
        'STORAGE_UNAVAILABLE',
        'Private clinical storage is unavailable pending configuration and validation.',
        503,
      );
    const image = await validateImage(data, mime);
    const storage = this.storage;
    const id = randomUUID();
    const fileId = randomUUID();
    const key = `clinical/${randomUUID()}/${randomUUID()}.png`;
    const studyId = existingStudy ?? randomUUID();
    await this.tx(context, patient, async (db, clinic, member) => {
      if (existingStudy) {
        const study = await db.query(
          'SELECT id FROM xray_studies WHERE clinic_id=$1 AND id=$2 AND patient_id=$3 FOR UPDATE',
          [clinic, studyId, patient],
        );
        if (!study.rowCount)
          throw new DomainError('IMAGE_NOT_FOUND', 'Clinical study not found.', 404);
      } else
        await db.query(
          "INSERT INTO xray_studies(id,clinic_id,patient_id,study_type,notes) VALUES($1,$2,$3,'uploaded','Unclassified uploaded study. Clinical acquisition time has not been established.')",
          [studyId, clinic, patient],
        );
      const version = await db.query<{ version: number }>(
        'SELECT coalesce(max(version),0)+1 AS version FROM clinical_image_versions WHERE clinic_id=$1 AND study_id=$2',
        [clinic, studyId],
      );
      await db.query(
        `INSERT INTO files(id,clinic_id,patient_id,storage_provider,bucket,object_key,original_filename,content_type,size_bytes,sha256,uploaded_by_membership_id)
        VALUES($1,$2,$3,'s3-private',$4,$5,'clinical-image.png',$6,$7,$8,$9)`,
        [
          fileId,
          clinic,
          patient,
          storage.bucket,
          key,
          image.contentType,
          image.data.length,
          image.sha256,
          member,
        ],
      );
      await db.query(
        `INSERT INTO clinical_image_versions(id,clinic_id,patient_id,study_id,file_id,version,owner_user_id,width,height,source_sha256,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          clinic,
          patient,
          studyId,
          fileId,
          version.rows[0]?.version,
          context.userId,
          image.width,
          image.height,
          image.sourceSha256,
          reason,
        ],
      );
      await this.audit(db, context, clinic, 'imaging.upload_reserved', id, {
        patientId: patient,
        studyId,
        reason,
        sha256: image.sha256,
      });
    });
    // The durable pending registration owns the object even if storage succeeds and publishing fails.
    try {
      await storage.put(key, image.data, image.contentType);
    } catch {
      throw new DomainError(
        'STORAGE_UNAVAILABLE',
        'Upload failed. A private pending registration is retained for reconciliation.',
        503,
      );
    }
    await this.tx(context, patient, async (db, clinic) => {
      await db.query(
        "UPDATE files SET status='available',available_at=now() WHERE clinic_id=$1 AND id=$2 AND status='pending'",
        [clinic, fileId],
      );
      await this.audit(db, context, clinic, 'imaging.upload_available', id, {
        patientId: patient,
        reason,
      });
    });
    return (await this.history(context, patient)).images.find((v) => v.id === id);
  }
  private async locate(context: AccessContext, id: string) {
    return this.tx(context, undefined, async (db, clinic) => {
      const row = await db.query<{
        object_key: string;
        sha256: string;
        content_type: string;
        size_bytes: string;
        patient_id: string;
      }>(
        `SELECT f.object_key,f.sha256,f.content_type,f.size_bytes::text,v.patient_id FROM clinical_image_versions v JOIN files f ON f.clinic_id=v.clinic_id AND f.id=v.file_id WHERE v.clinic_id=$1 AND v.id=$2 AND f.status='available'`,
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
  async analyze(context: AccessContext, id: string, reason: string) {
    const file = await this.locate(context, id);
    const runId = randomUUID();
    await this.tx(context, file.patient_id, async (db, clinic, member) => {
      await db.query(
        'INSERT INTO image_inference_runs(id,clinic_id,image_id,requested_by_membership_id,reason) VALUES($1,$2,$3,$4,$5)',
        [runId, clinic, id, member, reason],
      );
      await this.audit(db, context, clinic, 'imaging.analysis_requested', runId, {
        patientId: file.patient_id,
        imageId: id,
        reason,
      });
    });
    let result: InferenceResult | undefined;
    try {
      if (!this.inference) throw new Error('Inference disabled');
      result = await this.inference.infer((await this.content(context, id)).data);
    } catch {
      await this.tx(context, file.patient_id, async (db, clinic) => {
        await db.query(
          "UPDATE image_inference_runs SET status='failed',error_code='INFERENCE_UNAVAILABLE',completed_at=now() WHERE clinic_id=$1 AND id=$2",
          [clinic, runId],
        );
        await this.audit(db, context, clinic, 'imaging.analysis_failed', runId, {
          imageId: id,
          errorCode: 'INFERENCE_UNAVAILABLE',
          reason,
        });
      });
      throw new DomainError(
        'INFERENCE_UNAVAILABLE',
        'X-ray inference is unavailable. No findings were generated.',
        503,
      );
    }
    const observed = result;
    await this.tx(context, file.patient_id, async (db, clinic) => {
      await db.query(
        "UPDATE image_inference_runs SET status='succeeded',result=$3,completed_at=now() WHERE clinic_id=$1 AND id=$2",
        [clinic, runId, JSON.stringify(observed)],
      );
      for (const [ordinal, d] of observed.detections.entries())
        await db.query(
          `INSERT INTO image_model_detections(clinic_id,run_id,ordinal,class_id,class_name,score,x,y,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [clinic, runId, ordinal, d.classId, observed.classMap[d.classId], d.score, ...d.box],
        );
      await this.audit(db, context, clinic, 'imaging.analysis_draft', runId, {
        imageId: id,
        reason,
        modelVersion: observed.modelVersion,
        artifactSha256: observed.artifactSha256,
      });
    });
    return (await this.history(context, file.patient_id)).analyses.find((r) => r.id === runId);
  }
  async review(
    context: AccessContext,
    id: string,
    decision: 'confirmed' | 'rejected',
    reason: string,
  ) {
    return this.tx(context, undefined, async (db, clinic, member) => {
      const run = await db.query<{ image_id: string }>(
        "SELECT image_id FROM image_inference_runs WHERE clinic_id=$1 AND id=$2 AND status='succeeded' FOR UPDATE",
        [clinic, id],
      );
      if (!run.rowCount)
        throw new DomainError('IMAGE_NOT_FOUND', 'Successful analysis not found.', 404);
      if (
        (
          await db.query(
            'SELECT id FROM image_clinician_reviews WHERE clinic_id=$1 AND run_id=$2',
            [clinic, id],
          )
        ).rowCount
      )
        throw new DomainError(
          'REVIEW_CONFLICT',
          'This analysis has already been reviewed. Create a new analysis to correct it.',
          409,
        );
      await db.query(
        'INSERT INTO image_clinician_reviews(clinic_id,run_id,decision,author_membership_id,reason) VALUES($1,$2,$3,$4,$5)',
        [clinic, id, decision, member, reason],
      );
      await this.audit(db, context, clinic, `imaging.analysis_${decision}`, id, {
        reason,
        before: 'draft',
        after: decision,
        imageId: run.rows[0]?.image_id,
      });
      return { success: true as const };
    });
  }
}
