import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { DependencyUnavailableError } from '../../errors/domain-errors.js';
import type { AccessContext } from '../access/access.repository.js';
import { Access, InvoiceRow, denied, missing, conflict } from './billing-shared.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class BillingCore {
  constructor(readonly pool: Pool) {}
  protected async transaction<T>(
    context: AccessContext,
    mode: 'read' | 'write' | 'manage' | 'patient',
    fn: (db: PoolClient, a: Access) => Promise<T>,
  ): Promise<T> {
    const db = await this.pool.connect().catch(() => {
      throw new DependencyUnavailableError();
    });
    try {
      await db.query('BEGIN');
      const m = context.membership;
      if (!m) throw denied();
      await db.query('SELECT saas_lock($1)', [m.clinicId]);
      const roles = await db.query<{ key: string }>(
        `SELECT r.key FROM memberships m JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL JOIN clinics c ON c.id=m.clinic_id AND c.active
        JOIN auth_sessions s ON s.id=$3 AND s.user_id=u.id AND s.expires_at>now()
        JOIN membership_roles mr ON mr.clinic_id=m.clinic_id AND mr.membership_id=m.id JOIN roles r ON r.clinic_id=mr.clinic_id AND r.id=mr.role_id
        WHERE m.id=$1 AND m.clinic_id=$2 AND m.user_id=$4 AND m.status='active' AND (s.active_membership_id IS NULL OR s.active_membership_id=m.id) FOR SHARE OF m,u,c,s,mr,r`,
        [m.id, m.clinicId, context.sessionId, context.userId],
      );
      const keys = roles.rows.map((r) => r.key),
        manage = keys.some((r) => ['clinic_owner', 'clinic_admin'].includes(r)),
        write = manage || keys.includes('receptionist');
      const a = {
        clinicId: m.clinicId,
        membershipId: m.id,
        manage,
        write,
        patient: keys.includes('patient'),
      };
      if (
        !roles.rowCount ||
        !(mode === 'patient'
          ? a.patient
          : mode === 'manage'
            ? manage
            : mode === 'write'
              ? write
              : write || keys.includes('dentist'))
      )
        throw denied();
      const result = await fn(db, a);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      if (typeof error === 'object' && error !== null && 'code' in error) {
        if (['23505', '40001', '40P01'].includes(String(error.code))) throw conflict();
        if (/^(08|53|57|P0001)/.test(String(error.code))) throw new DependencyUnavailableError();
      }
      throw error;
    } finally {
      db.release();
    }
  }
  protected async audit(
    db: PoolClient,
    c: AccessContext,
    a: Access,
    action: string,
    id: string,
    reason: string,
    before: unknown,
    after: unknown,
    patientId?: string,
    invoiceId?: string,
  ) {
    await db.query(
      `INSERT INTO audit_events(clinic_id,actor_user_id,actor_membership_id,action,entity_type,entity_id,request_id,data,occurred_at) VALUES($1,$2,$3,$4,'billing',$5,$6,$7::jsonb,clock_timestamp())`,
      [
        a.clinicId,
        c.userId,
        a.membershipId,
        action,
        id,
        c.requestId,
        JSON.stringify({
          reason,
          before,
          after,
          ...(patientId ? { patientId } : {}),
          ...(invoiceId ? { invoiceId } : {}),
        }),
      ],
    );
  }
  protected async row(db: PoolClient, a: Access, id: string): Promise<InvoiceRow> {
    const r = await db.query<InvoiceRow>(
      `SELECT i.*,w.version,w.discarded_at FROM invoices i JOIN billing_invoice_workflows w ON w.clinic_id=i.clinic_id AND w.invoice_id=i.id WHERE i.clinic_id=$1 AND i.id=$2 FOR UPDATE OF i,w`,
      [a.clinicId, id],
    );
    if (!r.rows[0]) throw missing();
    return r.rows[0];
  }
  protected hash(a: Access, kind: string, target: string, body: object) {
    return createHash('sha256')
      .update(JSON.stringify({ actor: a.membershipId, kind, target, body }))
      .digest('hex');
  }
}
