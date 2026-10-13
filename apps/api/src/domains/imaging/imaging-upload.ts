import { randomUUID } from 'node:crypto';
import type { AccessContext } from '../access/access.repository.js';
import { DomainError } from '../../errors/domain-errors.js';
import { checksum, validateImage } from './image-validation.js';
import { reserveImagingOperation } from './imaging-operations.js';
import { ImagingCore } from './imaging-core.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class ImagingUploadRepository extends ImagingCore {
  async upload(
    context: AccessContext,
    patient: string,
    data: Buffer,
    mime: string,
    reason: string,
    existingStudy?: string,
    requestKey: string = randomUUID(),
  ) {
    // Authorization before expensive decoding; rechecked when reserving and publishing.
    const authorizedClinic = await this.tx(context, patient, async (_db, clinic) => clinic);
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
    const key = `clinical/${authorizedClinic}/${fileId}.png`;
    const studyId = existingStudy ?? randomUUID();
    const operation = await this.tx(context, patient, async (db, clinic, member) => {
      const operation = await reserveImagingOperation(
        db,
        clinic,
        context.userId,
        patient,
        requestKey,
        'upload',
        checksum(Buffer.from(JSON.stringify([image.sourceSha256, reason, existingStudy ?? null]))),
      );
      if (operation.replay) return operation;
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
        VALUES($1,$2,$3,$10,$4,$5,'clinical-image.png',$6,$7,$8,$9)`,
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
          storage.provider ?? 'private-adapter',
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
      await db.query('UPDATE imaging_operations SET image_id=$3 WHERE clinic_id=$1 AND id=$2', [
        clinic,
        operation.id,
        id,
      ]);
      return operation;
    });
    if (operation.replay)
      return (await this.history(context, patient)).images.find((v) => v.id === operation.imageId);
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
      await db.query(
        "UPDATE imaging_operations SET state='completed' WHERE clinic_id=$1 AND id=$2",
        [clinic, operation.id],
      );
    });
    return (await this.history(context, patient)).images.find((v) => v.id === id);
  }
}
