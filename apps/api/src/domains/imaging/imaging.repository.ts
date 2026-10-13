import { randomUUID } from 'node:crypto';
import { InferenceSchema, type InferenceResult } from '@dentalai/contracts';
import type { AccessContext } from '../access/access.repository.js';
import { DomainError } from '../../errors/domain-errors.js';
import { checksum } from './image-validation.js';
import { reserveImagingOperation } from './imaging-operations.js';
import { ImagingUploadRepository } from './imaging-upload.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class ImagingRepository extends ImagingUploadRepository {
  async analyze(
    context: AccessContext,
    id: string,
    reason: string,
    requestKey: string = randomUUID(),
  ) {
    const file = await this.locate(context, id);
    const runId = randomUUID();
    const operation = await this.tx(context, file.patient_id, async (db, clinic, member) => {
      const operation = await reserveImagingOperation(
        db,
        clinic,
        context.userId,
        file.patient_id,
        requestKey,
        'analysis',
        checksum(Buffer.from(JSON.stringify([id, reason]))),
      );
      if (operation.replay) return operation;
      await db.query(
        'INSERT INTO image_inference_runs(id,clinic_id,image_id,requested_by_membership_id,reason) VALUES($1,$2,$3,$4,$5)',
        [runId, clinic, id, member, reason],
      );
      await this.audit(db, context, clinic, 'imaging.analysis_requested', runId, {
        patientId: file.patient_id,
        imageId: id,
        reason,
      });
      await db.query(
        'UPDATE imaging_operations SET run_id=$3,image_id=$4 WHERE clinic_id=$1 AND id=$2',
        [clinic, operation.id, runId, id],
      );
      return operation;
    });
    if (operation.replay)
      return (await this.history(context, file.patient_id)).analyses.find(
        (r) => r.id === operation.runId,
      );
    let result: InferenceResult | undefined;
    try {
      if (!this.inference) throw new Error('Inference disabled');
      result = InferenceSchema.parse(
        await this.inference.infer((await this.content(context, id)).data),
      );
      if (
        result.detections.some(
          (d) => d.box[0] + d.box[2] > file.width || d.box[1] + d.box[3] > file.height,
        )
      )
        throw new Error('Detection outside source image');
    } catch {
      await this.tx(context, file.patient_id, async (db, clinic) => {
        await db.query(
          "UPDATE image_inference_runs SET status='failed',error_code='INFERENCE_UNAVAILABLE',completed_at=now() WHERE clinic_id=$1 AND id=$2 AND status='running'",
          [clinic, runId],
        );
        await this.audit(db, context, clinic, 'imaging.analysis_failed', runId, {
          imageId: id,
          errorCode: 'INFERENCE_UNAVAILABLE',
          reason,
        });
        await db.query(
          "UPDATE imaging_operations SET state='failed' WHERE clinic_id=$1 AND id=$2",
          [clinic, operation.id],
        );
      });
      throw new DomainError(
        'INFERENCE_UNAVAILABLE',
        'X-ray inference is unavailable. No findings were generated.',
        503,
      );
    }
    const observed = result;
    const { detections, ...metadata } = observed;
    await this.tx(context, file.patient_id, async (db, clinic) => {
      const completed = await db.query(
        "UPDATE image_inference_runs SET status='succeeded',result=$3,completed_at=now() WHERE clinic_id=$1 AND id=$2 AND status='running' AND lease_expires_at>now() RETURNING id",
        [clinic, runId, JSON.stringify({ ...metadata, detectionCount: detections.length })],
      );
      if (!completed.rowCount)
        throw new DomainError(
          'IMAGING_RECOVERY_REQUIRED',
          'The analysis lease expired or was recovered. No late result was published.',
          409,
        );
      for (const [ordinal, d] of detections.entries())
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
      await db.query(
        "UPDATE imaging_operations SET state='completed' WHERE clinic_id=$1 AND id=$2",
        [clinic, operation.id],
      );
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
