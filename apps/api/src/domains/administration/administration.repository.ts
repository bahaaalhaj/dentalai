import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { subscriptionAccess } from '@dentalai/domain';
import {
  AdministrationOverviewSchema,
  ClinicConfigurationResponseSchema,
  PlanSchema,
  SubscriptionSchema,
  type OnboardingSchema,
  type ConfigurationWriteSchema,
  type MemberChangeSchema,
  type LocationWriteSchema,
  type SubscriptionActionSchema,
  ExportSchema,
  type OffboardingSchema,
} from '@dentalai/contracts';
import type { AccessContext } from '../access/access.repository.js';
import type { AuthOptions } from '../auth/auth.provider.js';
import type { PrivateStorage } from '../imaging/storage.js';
import { DomainError } from '../../errors/domain-errors.js';
import { enqueueNotification } from '../notifications/notification.service.js';
import { AdministrativeSubscriptionProvider } from './subscription.provider.js';

const denied = () => new DomainError('ACCESS_DENIED', 'Clinic administration access denied.', 403);
const missing = () => new DomainError('NOT_FOUND', 'Administration resource not found.', 404);
const conflict = () =>
  new DomainError(
    'ADMINISTRATION_CONFLICT',
    'Configuration changed. Refresh before retrying.',
    409,
  );
const iso = (value: Date | null) => value?.toISOString() ?? null;
type Admin = { clinic: string; member: string; owner: boolean };
export class AdministrationRepository {
  constructor(
    readonly pool: Pool,
    private readonly options: AuthOptions,
    private readonly storage?: PrivateStorage,
  ) {}
  private async audit(
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
  private async tx<T>(
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
  private async fresh(db: PoolClient, context: AccessContext) {
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
  async onboard(context: AccessContext, body: z.infer<typeof OnboardingSchema>) {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('onboarding:'||$1,0))", [
        context.userId,
      ]);
      const session = await db.query(
        `SELECT u.id FROM users u JOIN auth_sessions s ON s.user_id=u.id WHERE u.id=$1 AND s.id=$2 AND s.expires_at>now() AND u.email_verified AND u.disabled_at IS NULL FOR SHARE OF u,s`,
        [context.userId, context.sessionId],
      );
      if (!session.rowCount) throw denied();
      const owned = await db.query(
        `SELECT DISTINCT m.clinic_id FROM memberships m JOIN membership_roles mr ON mr.membership_id=m.id AND mr.clinic_id=m.clinic_id JOIN roles r ON r.id=mr.role_id AND r.clinic_id=mr.clinic_id WHERE m.user_id=$1 AND r.key='clinic_owner'`,
        [context.userId],
      );
      if (owned.rowCount)
        throw new DomainError(
          'ONBOARDING_ALREADY_USED',
          'An owner may onboard one clinic; additional clinics require operator review.',
          409,
        );
      const clinic = randomUUID(),
        member = randomUUID(),
        location = randomUUID();
      await db.query(
        `INSERT INTO clinics(id,legal_name,display_name,slug,default_timezone,default_currency) VALUES($1,$2,$3,$4,$5,$6)`,
        [clinic, body.legalName, body.displayName, body.slug, body.timezone, body.currency],
      );
      await db.query('SELECT saas_lock($1)', [clinic]);
      await db.query('INSERT INTO clinic_settings(clinic_id) VALUES($1)', [clinic]);
      await db.query(
        `UPDATE clinic_profiles SET locale=$2,contact_email=$3,contact_phone=$4,brand_color=$5,brand_mark=$6 WHERE clinic_id=$1`,
        [
          clinic,
          body.locale,
          body.contactEmail,
          body.contactPhone,
          body.brandColor,
          body.brandMark,
        ],
      );
      for (const role of ['clinic_owner', 'clinic_admin', 'dentist', 'receptionist', 'patient'])
        await db.query('INSERT INTO roles(clinic_id,key,name) VALUES($1,$2,$2)', [clinic, role]);
      await db.query(
        "INSERT INTO memberships(id,clinic_id,user_id,status,joined_at) VALUES($1,$2,$3,'active',now())",
        [member, clinic, context.userId],
      );
      await db.query(
        "INSERT INTO membership_roles(clinic_id,membership_id,role_id) SELECT $1,$2,id FROM roles WHERE clinic_id=$1 AND key='clinic_owner'",
        [clinic, member],
      );
      await db.query("INSERT INTO staff(clinic_id,membership_id,kind) VALUES($1,$2,'staff')", [
        clinic,
        member,
      ]);
      await db.query('INSERT INTO locations(id,clinic_id,name,timezone) VALUES($1,$2,$3,$4)', [
        location,
        clinic,
        body.locationName,
        body.timezone,
      ]);
      await db.query(
        "INSERT INTO operatories(clinic_id,location_id,name) VALUES($1,$2,'Chair 1')",
        [clinic, location],
      );
      for (let day = 1; day <= 5; day++)
        await db.query(
          "INSERT INTO working_hours(clinic_id,location_id,weekday,opens_at_local,closes_at_local) VALUES($1,$2,$3,'09:00','17:00')",
          [clinic, location, day],
        );
      await db.query(
        "INSERT INTO appointment_types(clinic_id,name,code,default_duration_minutes) VALUES($1,'Consultation','consultation',30)",
        [clinic],
      );
      await db.query(
        'UPDATE auth_sessions SET clinic_id=$1,active_membership_id=$2 WHERE id=$3 AND user_id=$4',
        [clinic, member, context.sessionId, context.userId],
      );
      await this.audit(
        db,
        {
          ...context,
          membership: {
            id: member,
            clinicId: clinic,
            clinicName: body.displayName,
            roles: ['clinic_owner'],
          },
        },
        clinic,
        'admin.clinic_onboarded',
        'clinic',
        { defaults: 'Administrative trial; no payment processed', locale: body.locale },
      );
      await db.query('COMMIT');
      return {
        id: member,
        clinicId: clinic,
        clinicName: body.displayName,
        roles: ['clinic_owner'],
      };
    } catch (error) {
      await db.query('ROLLBACK');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
        throw conflict();
      throw error;
    } finally {
      db.release();
    }
  }
  private async configuration(db: PoolClient, clinic: string) {
    const result = await db.query(
      `SELECT c.id AS "clinicId",c.legal_name AS "legalName",c.display_name AS "displayName",c.default_currency AS currency,c.default_timezone AS timezone,
      p.locale,p.contact_email AS "contactEmail",p.contact_phone AS "contactPhone",p.brand_color AS "brandColor",p.brand_mark AS "brandMark",p.version
      FROM clinics c JOIN clinic_profiles p ON p.clinic_id=c.id WHERE c.id=$1`,
      [clinic],
    );
    return ClinicConfigurationResponseSchema.parse(result.rows[0]);
  }
  private async subscription(db: PoolClient, clinic: string) {
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
  async plans(context: AccessContext) {
    return this.tx(context, false, async (db) =>
      (
        await db.query(
          `SELECT code,name,version,jsonb_build_object('seats',seats,'locations',locations,'appointments',appointments_per_month,'storageBytes',storage_bytes) AS limits FROM saas_plans WHERE public ORDER BY seats`,
        )
      ).rows.map((row) => PlanSchema.parse(row)),
    );
  }
  async overview(context: AccessContext) {
    return this.tx(context, false, async (db, a) => {
      const usage = await db.query(
        `SELECT saas_usage($1,'seats')::integer AS seats,saas_usage($1,'locations')::integer AS locations,saas_usage($1,'appointments')::integer AS appointments,
      saas_usage($1,'storage')::bigint::text AS "storageBytes",to_char(now() AT TIME ZONE 'UTC','YYYY-MM') AS period,(SELECT count(*)::integer FROM notification_deliveries WHERE clinic_id=$1) AS notifications`,
        [a.clinic],
      );
      const members = await db.query(
        `SELECT m.id,u.display_name AS name,u.email,m.status,json_agg(r.key ORDER BY r.key) AS roles FROM memberships m JOIN users u ON u.id=m.user_id JOIN membership_roles mr ON mr.membership_id=m.id AND mr.clinic_id=m.clinic_id JOIN roles r ON r.id=mr.role_id AND r.clinic_id=mr.clinic_id WHERE m.clinic_id=$1 GROUP BY m.id,u.id ORDER BY m.created_at`,
        [a.clinic],
      );
      const locations = await db.query(
        'SELECT id,name,timezone,address_line_1 AS address,phone,active FROM locations WHERE clinic_id=$1 ORDER BY created_at',
        [a.clinic],
      );
      const offboarding = await db.query<{ requested_at: Date; completed_at: Date | null }>(
        'SELECT requested_at,completed_at FROM clinic_offboarding WHERE clinic_id=$1',
        [a.clinic],
      );
      return AdministrationOverviewSchema.parse({
        configuration: await this.configuration(db, a.clinic),
        subscription: await this.subscription(db, a.clinic),
        usage: { ...usage.rows[0], storageBytes: Number(usage.rows[0]?.['storageBytes']) },
        members: members.rows,
        locations: locations.rows,
        offboarding: {
          requestedAt: iso(offboarding.rows[0]?.requested_at ?? null),
          completedAt: iso(offboarding.rows[0]?.completed_at ?? null),
          retention: 'retained-no-automatic-deletion',
        },
      });
    });
  }
  async configure(context: AccessContext, body: z.infer<typeof ConfigurationWriteSchema>) {
    return this.tx(context, false, async (db, a) => {
      const before = await this.configuration(db, a.clinic);
      if (before.version !== body.version) throw conflict();
      await db.query(
        'UPDATE clinics SET legal_name=$2,display_name=$3,default_timezone=$4,default_currency=$5,updated_at=now() WHERE id=$1',
        [a.clinic, body.legalName, body.displayName, body.timezone, body.currency],
      );
      await db.query(
        `UPDATE clinic_profiles SET locale=$2,contact_email=$3,contact_phone=$4,brand_color=$5,brand_mark=$6,version=version+1,updated_at=now() WHERE clinic_id=$1`,
        [
          a.clinic,
          body.locale,
          body.contactEmail,
          body.contactPhone,
          body.brandColor,
          body.brandMark,
        ],
      );
      const after = await this.configuration(db, a.clinic);
      await this.audit(db, context, a.clinic, 'admin.configuration_changed', 'clinic', {
        reason: body.reason,
        before,
        after,
      });
      return after;
    });
  }
  async member(context: AccessContext, id: string, body: z.infer<typeof MemberChangeSchema>) {
    return this.tx(context, false, async (db, a) => {
      if (id === a.member) throw denied();
      const target = await db.query<{ key: string }>(
        `SELECT r.key FROM memberships m JOIN membership_roles mr ON mr.membership_id=m.id AND mr.clinic_id=m.clinic_id JOIN roles r ON r.id=mr.role_id AND r.clinic_id=mr.clinic_id WHERE m.id=$1 AND m.clinic_id=$2 FOR UPDATE OF m`,
        [id, a.clinic],
      );
      if (!target.rowCount) throw missing();
      const keys = target.rows.map((r) => r.key);
      if (
        keys.includes('clinic_owner') ||
        keys.every((key) => key === 'patient') ||
        (!a.owner && (body.role === 'clinic_admin' || keys.includes('clinic_admin')))
      )
        throw denied();
      await db.query(
        'UPDATE memberships SET status=$3,updated_at=now() WHERE clinic_id=$1 AND id=$2',
        [a.clinic, id, body.status],
      );
      await db.query(
        'INSERT INTO membership_roles(clinic_id,membership_id,role_id) SELECT $1,$2,id FROM roles WHERE clinic_id=$1 AND key=$3 ON CONFLICT DO NOTHING',
        [a.clinic, id, body.role],
      );
      // Keep the existing seat during role replacement; reactivation is checked separately.
      await db.query(
        "DELETE FROM membership_roles mr USING roles r WHERE mr.clinic_id=$1 AND mr.membership_id=$2 AND r.id=mr.role_id AND r.clinic_id=mr.clinic_id AND r.key NOT IN ('patient',$3)",
        [a.clinic, id, body.role],
      );
      const staff = await db.query<{ id: string }>(
        `INSERT INTO staff(clinic_id,membership_id,kind,active) VALUES($1,$2,$3,$4) ON CONFLICT(clinic_id,membership_id) DO UPDATE SET active=EXCLUDED.active,kind=EXCLUDED.kind RETURNING id`,
        [a.clinic, id, body.role === 'dentist' ? 'provider' : 'staff', body.status === 'active'],
      );
      const staffId = staff.rows[0]!.id;
      if (body.role === 'dentist')
        await db.query(
          `INSERT INTO providers(clinic_id,staff_id,provider_type,active) VALUES($1,$2,'dentist',$3) ON CONFLICT(clinic_id,staff_id) DO UPDATE SET active=EXCLUDED.active`,
          [a.clinic, staffId, body.status === 'active'],
        );
      else
        await db.query('UPDATE providers SET active=false WHERE clinic_id=$1 AND staff_id=$2', [
          a.clinic,
          staffId,
        ]);
      await db.query(
        "UPDATE invitations SET status='revoked' WHERE clinic_id=$1 AND invited_by_membership_id=$2 AND status='pending'",
        [a.clinic, id],
      );
      await db.query('DELETE FROM auth_sessions WHERE clinic_id=$1 AND active_membership_id=$2', [
        a.clinic,
        id,
      ]);
      await this.audit(db, context, a.clinic, 'admin.membership_changed', 'membership', {
        membershipId: id,
        reason: body.reason,
        before: keys,
        after: { role: body.role, status: body.status },
      });
      return { success: true };
    });
  }
  async location(context: AccessContext, body: z.infer<typeof LocationWriteSchema>) {
    return this.tx(context, false, async (db, a) => {
      let result;
      if (body.id)
        result = await db.query(
          'UPDATE locations SET name=$3,timezone=$4,address_line_1=$5,phone=$6,active=$7,updated_at=now() WHERE clinic_id=$1 AND id=$2 RETURNING id,name,timezone,address_line_1 AS address,phone,active',
          [a.clinic, body.id, body.name, body.timezone, body.address, body.phone, body.active],
        );
      else
        result = await db.query(
          'INSERT INTO locations(clinic_id,name,timezone,address_line_1,phone,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,timezone,address_line_1 AS address,phone,active',
          [a.clinic, body.name, body.timezone, body.address, body.phone, body.active],
        );
      if (!result.rows[0]) throw missing();
      await this.audit(db, context, a.clinic, 'admin.location_changed', 'location', {
        reason: body.reason,
        locationId: result.rows[0]['id'],
        active: body.active,
      });
      return result.rows[0];
    });
  }
  private async subscriptionEvent(
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
  async subscriptionAction(context: AccessContext, body: z.infer<typeof SubscriptionActionSchema>) {
    return this.tx(context, true, async (db, a) => {
      const before = await this.subscription(db, a.clinic);
      if (before.version !== body.version) throw conflict();
      if (body.action === 'request_plan') {
        if (!body.planCode) throw new DomainError('INVALID_SUBSCRIPTION', 'Select a plan.', 422);
        await db.query(
          'UPDATE clinic_subscriptions SET requested_plan=$2,version=version+1,updated_at=now() WHERE clinic_id=$1',
          [a.clinic, body.planCode],
        );
      } else if (body.action === 'cancel')
        await db.query(
          "UPDATE clinic_subscriptions SET cancel_at_period_end=true,period_end=coalesce(period_end,now()+interval '30 days'),version=version+1,updated_at=now() WHERE clinic_id=$1",
          [a.clinic],
        );
      else {
        if (!before.growthAllowed || !before.cancelAtPeriodEnd)
          throw new DomainError(
            'INVALID_SUBSCRIPTION',
            'Only an unexpired scheduled cancellation may be resumed.',
            409,
          );
        await db.query(
          'UPDATE clinic_subscriptions SET cancel_at_period_end=false,version=version+1,updated_at=now() WHERE clinic_id=$1',
          [a.clinic],
        );
      }
      const after = await this.subscription(db, a.clinic);
      await this.subscriptionEvent(db, context, a.clinic, body.action, body.reason, before, after);
      const owner = await db.query<{ email: string }>('SELECT email FROM users WHERE id=$1', [
        context.userId,
      ]);
      await enqueueNotification(
        db,
        a.clinic,
        {
          to: owner.rows[0]!.email,
          subject: 'DentalAI subscription administration',
          text: 'Your clinic subscription administration changed. Sign in to review it. No payment was processed.',
        },
        this.options.secret,
        { category: 'operational', membershipId: a.member },
      );
      return after;
    });
  }
  /** Server-operator interface only; deliberately not mounted as an HTTP endpoint. */
  async administrativeGrant(
    clinic: string,
    plan: 'starter' | 'team',
    action: 'activate' | 'past_due' | 'suspend' | 'cancel',
    reason: string,
  ) {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT saas_lock($1)', [clinic]);
      if (!(await db.query('SELECT 1 FROM clinics WHERE id=$1 AND active', [clinic])).rowCount)
        throw missing();
      const before = await this.subscription(db, clinic),
        provider = new AdministrativeSubscriptionProvider();
      const changes = provider.change(before, action, new Date());
      await db.query(
        `UPDATE clinic_subscriptions SET plan_code=$2,state=$3,period_end=$4,grace_end=$5,cancel_at_period_end=$6,requested_plan=NULL,version=version+1,updated_at=now() WHERE clinic_id=$1`,
        [
          clinic,
          plan,
          changes.state,
          changes.periodEnd,
          changes.graceEnd,
          changes.cancelAtPeriodEnd,
        ],
      );
      const after = await this.subscription(db, clinic);
      await this.subscriptionEvent(db, null, clinic, action, reason, before, after);
      await db.query('COMMIT');
      return after;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
  async auditSummary(context: AccessContext) {
    return this.tx(context, true, async (db, a) =>
      (
        await db.query(
          `SELECT e.id,e.action,e.entity_type AS "entityType",e.occurred_at AS "occurredAt",u.display_name AS "actorName" FROM audit_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.clinic_id=$1 ORDER BY e.occurred_at DESC,e.id LIMIT 100`,
          [a.clinic],
        )
      ).rows.map((row) => ({ ...row, occurredAt: (row['occurredAt'] as Date).toISOString() })),
    );
  }
  async notifications(context: AccessContext) {
    return this.tx(context, false, async (db, a) =>
      (
        await db.query(
          `SELECT id,recipient,category,state,attempts,provider,error_code AS "errorCode",created_at AS "createdAt",accepted_at AS "acceptedAt" FROM notification_deliveries WHERE clinic_id=$1 ORDER BY created_at DESC LIMIT 100`,
          [a.clinic],
        )
      ).rows.map((row) => ({
        ...row,
        createdAt: (row['createdAt'] as Date).toISOString(),
        acceptedAt: iso(row['acceptedAt'] as Date | null),
      })),
    );
  }
  async preferences(context: AccessContext, value?: boolean) {
    return this.tx(context, 'member', async (db, a) => {
      if (value !== undefined) {
        await db.query(
          `INSERT INTO notification_preferences(clinic_id,membership_id,operational_email) VALUES($1,$2,$3) ON CONFLICT(clinic_id,membership_id) DO UPDATE SET operational_email=EXCLUDED.operational_email,updated_at=now()`,
          [a.clinic, a.member, value],
        );
        await this.audit(
          db,
          context,
          a.clinic,
          'admin.notification_preference_changed',
          'membership',
          { operationalEmail: value },
        );
      }
      const result = await db.query<{ operational_email: boolean }>(
        'SELECT operational_email FROM notification_preferences WHERE clinic_id=$1 AND membership_id=$2',
        [a.clinic, a.member],
      );
      return { operationalEmail: result.rows[0]?.operational_email ?? true };
    });
  }
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
