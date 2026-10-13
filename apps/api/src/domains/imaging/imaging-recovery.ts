import { z } from 'zod';
import type { Pool } from 'pg';
import type { PrivateStorage } from './storage.js';
import { checksum } from './image-validation.js';
/** Operator-controlled, explicitly tenant-scoped recovery. No object deletion or fabricated result. */
export async function reconcileImaging(
  pool: Pool,
  storage: PrivateStorage,
  clinicId: string,
  actorUserId: string,
  reason: string,
) {
  z.uuid().parse(clinicId);
  z.uuid().parse(actorUserId);
  z.string().trim().min(3).max(500).parse(reason);
  const db = await pool.connect();
  const deadline = AbortSignal.timeout(30000);
  try {
    await db.query('BEGIN');
    await db.query('SELECT saas_lock($1)', [clinicId]);
    const authority = await db.query(
      `SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL
      JOIN clinics c ON c.id=m.clinic_id AND c.active JOIN membership_roles mr ON mr.clinic_id=m.clinic_id AND mr.membership_id=m.id
      JOIN roles r ON r.clinic_id=mr.clinic_id AND r.id=mr.role_id
      WHERE m.clinic_id=$1 AND m.user_id=$2 AND m.status='active' AND r.key='clinic_owner' FOR SHARE OF m,u,c,mr,r`,
      [clinicId, actorUserId],
    );
    if (!authority.rowCount)
      throw new Error('Recovery requires an active owner of the explicitly selected clinic.');
    const audit = (action: string, id: string, data: object) =>
      db.query(
        "INSERT INTO audit_events(clinic_id,actor_user_id,action,entity_type,entity_id,data) VALUES($1,$2,$3,'clinical_image',$4,$5)",
        [clinicId, actorUserId, action, id, JSON.stringify({ ...data, reason })],
      );
    const stale = await db.query<{ id: string; image_id: string }>(
      `UPDATE image_inference_runs SET status='failed',error_code='INFERENCE_INTERRUPTED',completed_at=now()
      WHERE clinic_id=$1 AND id IN (SELECT id FROM image_inference_runs WHERE clinic_id=$1 AND status='running' AND lease_expires_at<now() AND created_at<now()-interval '2 minutes' ORDER BY created_at LIMIT 50 FOR UPDATE) RETURNING id,image_id`,
      [clinicId],
    );
    for (const run of stale.rows) {
      await audit('imaging.analysis_recovered_failed', run.id, {
        imageId: run.image_id,
        before: 'running',
        after: 'failed',
        errorCode: 'INFERENCE_INTERRUPTED',
      });
      await db.query(
        "UPDATE imaging_operations SET state='failed' WHERE clinic_id=$1 AND run_id=$2 AND state='pending'",
        [clinicId, run.id],
      );
    }
    const pending = await db.query<{
      id: string;
      image_id: string;
      object_key: string;
      sha256: string;
      size_bytes: string;
    }>(
      `SELECT f.id,v.id AS image_id,f.object_key,f.sha256,f.size_bytes::text
      FROM files f JOIN clinical_image_versions v ON v.clinic_id=f.clinic_id AND v.file_id=f.id
      WHERE f.clinic_id=$1 AND f.status='pending' AND f.created_at<now()-interval '2 minutes'
      AND NOT EXISTS(SELECT 1 FROM imaging_operations o WHERE o.clinic_id=f.clinic_id AND o.image_id=v.id AND o.state='pending' AND o.lease_expires_at>now())
      ORDER BY f.created_at LIMIT 50 FOR UPDATE OF f`,
      [clinicId],
    );
    let published = 0,
      retained = 0;
    for (const file of pending.rows) {
      deadline.throwIfAborted();
      let data: Buffer;
      try {
        data = await storage.get(file.object_key, deadline);
      } catch {
        deadline.throwIfAborted();
        retained++;
        continue;
      }
      deadline.throwIfAborted();
      if (data.length !== Number(file.size_bytes) || checksum(data) !== file.sha256) {
        retained++;
        continue;
      }
      await db.query(
        "UPDATE files SET status='available',available_at=now() WHERE clinic_id=$1 AND id=$2 AND status='pending'",
        [clinicId, file.id],
      );
      await db.query(
        "UPDATE imaging_operations SET state='completed' WHERE clinic_id=$1 AND image_id=$2 AND kind='upload' AND state='pending'",
        [clinicId, file.image_id],
      );
      await audit('imaging.upload_recovered_available', file.image_id, {
        before: 'pending',
        after: 'available',
        checksumVerified: true,
      });
      published++;
    }
    await audit('imaging.reconciliation_completed', clinicId, {
      failedRuns: stale.rowCount,
      published,
      retained,
    });
    deadline.throwIfAborted();
    await db.query('COMMIT');
    return { failedRuns: stale.rowCount, published, retained };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
