import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ExportSchema, type OffboardingSchema } from '@dentalai/contracts';
import type { AccessContext } from '../access/access.repository.js';
import { DomainError } from '../../errors/domain-errors.js';
import { missing, iso } from './administration-shared.js';
import { AdministrationMembershipRepository } from './administration-membership.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class AdministrationExportRepository extends AdministrationMembershipRepository {
  async export(context: AccessContext, reason: string) {
    return this.tx(
      context,
      true,
      async (db, a) => {
        await this.fresh(db, context);
        const catalog = await db.query<{ table_name: string }>(
          "SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='clinic_id' ORDER BY table_name",
        );
        const tables: Record<string, Record<string, unknown>[]> = {},
          counts: Record<string, number> = {};
        // Authentication/session/token infrastructure is NEVER part of a tenant export.
        const exclude = new Set(['auth_sessions', 'sessions', 'clinic_exports', 'outbox_jobs']);
        const clinic = await db.query<{ row: Record<string, unknown> }>(
          'SELECT to_jsonb(c) AS row FROM clinics c WHERE id=$1',
          [a.clinic],
        );
        tables['clinics'] = clinic.rows.map((r) => r.row);
        counts['clinics'] = clinic.rows.length;
        let totalRows = 1,
          totalBytes = 0;
        for (const { table_name: table } of catalog.rows) {
          if (exclude.has(table)) continue;
          if (!/^[a-z_]+$/.test(table)) throw new Error('Unexpected export table');
          const result = await db.query<{ row: Record<string, unknown> }>(
            `SELECT to_jsonb(t) AS row FROM "${table}" t WHERE clinic_id=$1 ORDER BY to_jsonb(t)::text LIMIT 10001`,
            [a.clinic],
          );
          if (result.rows.length > 10000)
            throw new DomainError(
              'EXPORT_REQUIRES_OPERATOR',
              'This clinic requires an operator-managed streaming export.',
              409,
            );
          tables[table] = result.rows.map(({ row }) => {
            const safe = { ...row };
            for (const key of ['token_hash', 'encrypted_message', 'object_key', 'bucket'])
              delete safe[key];
            return safe;
          });
          counts[table] = result.rows.length;
          totalRows += result.rows.length;
          totalBytes += Buffer.byteLength(JSON.stringify(tables[table]));
          if (totalRows > 50000 || totalBytes > 20 * 1024 * 1024)
            throw new DomainError(
              'EXPORT_REQUIRES_OPERATOR',
              'This clinic requires an operator-managed streaming export.',
              409,
            );
        }
        const identities = await db.query<{ row: Record<string, unknown> }>(
          `SELECT jsonb_build_object('id',u.id,'name',u.display_name,'email',u.email) AS row FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.clinic_id=$1 ORDER BY u.id`,
          [a.clinic],
        );
        tables['member_identities'] = identities.rows.map((r) => r.row);
        counts['member_identities'] = identities.rows.length;
        if (
          Object.values(counts).reduce((sum, n) => sum + n, 0) > 50000 ||
          Buffer.byteLength(JSON.stringify(tables)) > 20 * 1024 * 1024
        )
          throw new DomainError(
            'EXPORT_REQUIRES_OPERATOR',
            'This clinic requires an operator-managed streaming export.',
            409,
          );
        const files = (
          await db.query<{ id: string; sha256: string; size_bytes: string }>(
            "SELECT id,sha256,size_bytes FROM files WHERE clinic_id=$1 AND status='available' ORDER BY id",
            [a.clinic],
          )
        ).rows.map((row) => ({
          id: row.id,
          sha256: row.sha256,
          sizeBytes: Number(row.size_bytes),
          downloadPath: `/api/v1/admin/export-files/${row.id}`,
        }));
        const id = randomUUID(),
          createdAt = new Date().toISOString(),
          sha256 = createHash('sha256').update(JSON.stringify({ tables, files })).digest('hex');
        const value = ExportSchema.parse({
          id,
          clinicId: a.clinic,
          createdAt,
          schemaVersion: 'phase13-v1',
          tables,
          counts,
          files,
          sha256,
        });
        await db.query(
          'INSERT INTO clinic_exports(id,clinic_id,requested_by,reason,manifest) VALUES($1,$2,$3,$4,$5)',
          [
            id,
            a.clinic,
            a.member,
            reason,
            JSON.stringify({ counts, files, sha256, schemaVersion: 'phase13-v1' }),
          ],
        );
        await this.audit(db, context, a.clinic, 'admin.clinic_exported', 'clinic', {
          reason,
          exportId: id,
          counts,
          sha256,
        });
        return value;
      },
      true,
    );
  }
  async exportFile(context: AccessContext, id: string) {
    return this.tx(context, true, async (db, a) => {
      await this.fresh(db, context);
      if (!this.storage)
        throw new DomainError('STORAGE_UNAVAILABLE', 'Private storage is unavailable.', 503);
      const result = await db.query<{ object_key: string; sha256: string; content_type: string }>(
        "SELECT object_key,sha256,content_type FROM files WHERE clinic_id=$1 AND id=$2 AND status='available'",
        [a.clinic, id],
      );
      const file = result.rows[0];
      if (!file) throw missing();
      const bytes = await this.storage.get(file.object_key);
      if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
        throw new DomainError('FILE_INTEGRITY_ERROR', 'Private file integrity check failed.', 503);
      await this.audit(db, context, a.clinic, 'admin.export_file_downloaded', 'file', {
        fileId: id,
      });
      return { bytes, contentType: file.content_type };
    });
  }
  async requestOffboarding(context: AccessContext, reason: string) {
    return this.tx(context, true, async (db, a) => {
      await this.fresh(db, context);
      const result = await db.query<{ requested_at: Date }>(
        `INSERT INTO clinic_offboarding(clinic_id,requested_by,reason) VALUES($1,$2,$3) ON CONFLICT(clinic_id) DO UPDATE SET reason=EXCLUDED.reason RETURNING requested_at`,
        [a.clinic, a.member, reason],
      );
      await this.audit(db, context, a.clinic, 'admin.offboarding_requested', 'clinic', {
        reason,
        retention: 'no deletion',
      });
      return {
        requestedAt: iso(result.rows[0]!.requested_at),
        completedAt: null,
        retention: 'retained-no-automatic-deletion',
      };
    });
  }
  async offboard(context: AccessContext, body: z.infer<typeof OffboardingSchema>) {
    return this.tx(context, true, async (db, a) => {
      await this.fresh(db, context);
      const configuration = await this.configuration(db, a.clinic);
      if (body.confirmation !== configuration.displayName)
        throw new DomainError(
          'CONFIRMATION_REQUIRED',
          'Type the exact clinic name to confirm offboarding.',
          422,
        );
      const exported = await db.query(
        "SELECT 1 FROM clinic_exports WHERE clinic_id=$1 AND id=$2 AND requested_by=$3 AND created_at>now()-interval '24 hours'",
        [a.clinic, body.exportId, a.member],
      );
      if (!exported.rowCount)
        throw new DomainError(
          'EXPORT_REQUIRED',
          'Create and retain a recent authorized export before offboarding.',
          409,
        );
      const result = await db.query(
        'UPDATE clinic_offboarding SET completed_at=now(),export_id=$2 WHERE clinic_id=$1 AND completed_at IS NULL RETURNING clinic_id',
        [a.clinic, body.exportId],
      );
      if (!result.rowCount)
        throw new DomainError('OFFBOARDING_NOT_REQUESTED', 'Request offboarding first.', 409);
      await db.query('UPDATE clinics SET active=false WHERE id=$1', [a.clinic]);
      await db.query(
        "UPDATE clinic_subscriptions SET state='cancelled',cancel_at_period_end=false,version=version+1 WHERE clinic_id=$1",
        [a.clinic],
      );
      await db.query(
        "UPDATE invitations SET status='revoked' WHERE clinic_id=$1 AND status='pending'",
        [a.clinic],
      );
      await db.query(
        'UPDATE auth_sessions SET clinic_id=NULL,active_membership_id=NULL WHERE clinic_id=$1',
        [a.clinic],
      );
      await this.audit(db, context, a.clinic, 'admin.offboarding_completed', 'clinic', {
        reason: body.reason,
        exportId: body.exportId,
        retention: 'retained-no-automatic-deletion',
      });
      return { success: true };
    });
  }
}
