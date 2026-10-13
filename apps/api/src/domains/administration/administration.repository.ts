import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type OnboardingSchema, type SubscriptionActionSchema } from '@dentalai/contracts';
import type { AccessContext } from '../access/access.repository.js';
import { DomainError } from '../../errors/domain-errors.js';
import { enqueueNotification } from '../notifications/notification.service.js';
import { AdministrativeSubscriptionProvider } from './subscription.provider.js';
import { denied, missing, conflict } from './administration-shared.js';
import { AdministrationExportRepository } from './administration-export.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class AdministrationRepository extends AdministrationExportRepository {
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
}
