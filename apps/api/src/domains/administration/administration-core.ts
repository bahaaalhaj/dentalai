import type { Pool, PoolClient } from 'pg';
import { subscriptionAccess } from '@dentalai/domain';
import { ClinicConfigurationResponseSchema, SubscriptionSchema } from '@dentalai/contracts';
import type { AccessContext } from '../access/access.repository.js';
import type { AuthOptions } from '../auth/auth.provider.js';
import type { PrivateStorage } from '../imaging/storage.js';
import { DomainError } from '../../errors/domain-errors.js';
import { denied, missing, conflict, iso, Admin } from './administration-shared.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class AdministrationCore {
  constructor(
    readonly pool: Pool,
    protected readonly options: AuthOptions,
    protected readonly storage?: PrivateStorage,
  ) {}
  protected async audit(
    db: PoolClient,
    context: AccessContext | null,
    clinic: string,
    action: string,
    entity: string,
    data: object,
  ) {
    await db.query(
      `INSERT INTO audit_events(clinic_id,actor_user_id,actor_membership_id,action,entity_type,request_id,data)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        clinic,
        context?.userId ?? null,
        context?.membership?.id ?? null,
        action,
        entity,
        context?.requestId ?? null,
        JSON.stringify(data),
      ],
    );
  }
  protected async tx<T>(
    context: AccessContext,
    owner: boolean | 'member',
    fn: (db: PoolClient, a: Admin) => Promise<T>,
    snapshot = false,
  ): Promise<T> {
    const m = context.membership;
    if (!m) throw denied();
    const db = await this.pool.connect();
    try {
      await db.query(snapshot ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN');
      await db.query('SELECT saas_lock($1)', [m.clinicId]);
      const result = await db.query<{ key: string }>(
        `SELECT r.key FROM memberships m JOIN clinics c ON c.id=m.clinic_id AND c.active
       JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL AND u.email_verified
       JOIN auth_sessions s ON s.id=$3 AND s.user_id=u.id AND s.expires_at>now()
       JOIN membership_roles mr ON mr.membership_id=m.id AND mr.clinic_id=m.clinic_id
       JOIN roles r ON r.id=mr.role_id AND r.clinic_id=mr.clinic_id
       WHERE m.id=$1 AND m.clinic_id=$2 AND m.user_id=$4 AND m.status='active'
       AND (s.active_membership_id IS NULL OR s.active_membership_id=m.id) FOR SHARE OF m,c,u,s,mr,r`,
        [m.id, m.clinicId, context.sessionId, context.userId],
      );
      const isOwner = result.rows.some((r) => r.key === 'clinic_owner');
      if (!result.rowCount) throw denied();
      if (
        !isOwner &&
        (owner === true ||
          (owner !== 'member' && !result.rows.some((r) => r.key === 'clinic_admin')))
      )
        throw denied();
      const value = await fn(db, { clinic: m.clinicId, member: m.id, owner: isOwner });
      await db.query('COMMIT');
      return value;
    } catch (error) {
      await db.query('ROLLBACK');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
        throw conflict();
      throw error;
    } finally {
      db.release();
    }
  }
  protected async fresh(db: PoolClient, context: AccessContext) {
    if (
      !(
        await db.query(
          "SELECT 1 FROM auth_sessions WHERE id=$1 AND user_id=$2 AND created_at>now()-interval '15 minutes' AND expires_at>now()",
          [context.sessionId, context.userId],
        )
      ).rowCount
    )
      throw new DomainError(
        'REAUTHENTICATION_REQUIRED',
        'Sign out and sign in again before exporting or offboarding.',
        403,
      );
  }
  protected async configuration(db: PoolClient, clinic: string) {
    const result = await db.query(
      `SELECT c.id AS "clinicId",c.legal_name AS "legalName",c.display_name AS "displayName",c.default_currency AS currency,c.default_timezone AS timezone,
      p.locale,p.contact_email AS "contactEmail",p.contact_phone AS "contactPhone",p.brand_color AS "brandColor",p.brand_mark AS "brandMark",p.version
      FROM clinics c JOIN clinic_profiles p ON p.clinic_id=c.id WHERE c.id=$1`,
      [clinic],
    );
    return ClinicConfigurationResponseSchema.parse(result.rows[0]);
  }
  protected async subscription(db: PoolClient, clinic: string) {
    const result = await db.query<{
      plan_code: string;
      state: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
      period_end: Date | null;
      grace_end: Date | null;
      cancel_at_period_end: boolean;
      requested_plan: string | null;
      version: number;
      seats: number;
      locations: number;
      appointments_per_month: number;
      storage_bytes: string;
    }>(
      'SELECT s.*,p.seats,p.locations,p.appointments_per_month,p.storage_bytes FROM clinic_subscriptions s JOIN saas_plans p ON p.code=s.plan_code WHERE s.clinic_id=$1',
      [clinic],
    );
    const row = result.rows[0];
    if (!row) throw missing();
    const state = {
      state: row.state,
      periodEnd: iso(row.period_end),
      graceEnd: iso(row.grace_end),
      cancelAtPeriodEnd: row.cancel_at_period_end,
    };
    const clock = await db.query<{ now: Date }>('SELECT now() AS now');
    return SubscriptionSchema.parse({
      ...state,
      ...subscriptionAccess(state, clock.rows[0]!.now),
      planCode: row.plan_code,
      provider: 'administrative-mock',
      requestedPlan: row.requested_plan,
      version: row.version,
      limits: {
        seats: row.seats,
        locations: row.locations,
        appointments: row.appointments_per_month,
        storageBytes: Number(row.storage_bytes),
      },
    });
  }
  protected async subscriptionEvent(
    db: PoolClient,
    context: AccessContext | null,
    clinic: string,
    action: string,
    reason: string,
    before: object,
    after: object,
  ) {
    await db.query(
      'INSERT INTO subscription_events(clinic_id,actor_user_id,action,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)',
      [
        clinic,
        context?.userId ?? null,
        action,
        reason,
        JSON.stringify(before),
        JSON.stringify(after),
      ],
    );
    await this.audit(db, context, clinic, 'admin.subscription_changed', 'subscription', {
      reason,
      before,
      after,
      provider: 'administrative-mock',
      paymentProcessed: false,
    });
  }
}
