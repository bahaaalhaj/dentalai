import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DomainError } from '../../errors/domain-errors.js';
export async function reserveImagingOperation(
  db: PoolClient,
  clinic: string,
  actor: string,
  patient: string,
  key: string,
  kind: 'upload' | 'analysis',
  digest: string,
) {
  const prior = await db.query<{
    id: string;
    actor_user_id: string;
    patient_id: string;
    kind: string;
    request_sha256: string;
    state: string;
    image_id: string | null;
    run_id: string | null;
  }>('SELECT * FROM imaging_operations WHERE clinic_id=$1 AND request_key=$2 FOR UPDATE', [
    clinic,
    key,
  ]);
  const operation = prior.rows[0];
  if (operation) {
    if (
      operation.actor_user_id !== actor ||
      operation.patient_id !== patient ||
      operation.kind !== kind ||
      operation.request_sha256 !== digest
    )
      throw new DomainError(
        'IDEMPOTENCY_CONFLICT',
        'The request key belongs to a different operation.',
        409,
      );
    if (operation.state !== 'completed')
      throw new DomainError(
        'IMAGING_RECOVERY_REQUIRED',
        'The previous operation is retained pending recovery or review. Do not create duplicate work.',
        409,
      );
    return {
      replay: true as const,
      id: operation.id,
      imageId: operation.image_id,
      runId: operation.run_id,
    };
  }
  const id = randomUUID();
  await db.query(
    'INSERT INTO imaging_operations(id,clinic_id,request_key,kind,actor_user_id,patient_id,request_sha256) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id, clinic, key, kind, actor, patient, digest],
  );
  return { replay: false as const, id, imageId: null, runId: null };
}
