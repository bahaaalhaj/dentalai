import { z } from 'zod';
import {
  AdministrationOverviewSchema,
  PlanSchema,
  type ConfigurationWriteSchema,
  type MemberChangeSchema,
  type LocationWriteSchema,
} from '@dentalai/contracts';
import type { AccessContext } from '../access/access.repository.js';
import { denied, missing, conflict, iso } from './administration-shared.js';
import { AdministrationCore } from './administration-core.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class AdministrationMembershipRepository extends AdministrationCore {
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
}
