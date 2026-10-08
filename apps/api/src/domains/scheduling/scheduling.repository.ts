import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  AppointmentSchema,
  SchedulingCatalogSchema,
  type Appointment,
  type ClinicRole,
  type AvailabilityQuerySchema,
  type AppointmentListQuerySchema,
  type AppointmentActionSchema,
  type HourInputSchema,
  type ClosureInputSchema,
  type OperatoryInputSchema,
  type TypeInputSchema,
  type SchedulingPolicySchema,
} from '@dentalai/contracts';
import {
  actionTargets,
  canTransition,
  calendarDateDistance,
  dateInZone,
  weekday,
  wallClockSlots,
  type AppointmentState,
} from '@dentalai/domain';
import type { z } from 'zod';
import type { AccessContext } from '../access/access.repository.js';
import { DomainError } from '../../errors/domain-errors.js';

type Access = AccessContext & { clinicId: string; membershipId: string; roles: ClinicRole[] };
type Queryable = Pool | PoolClient;
interface Candidate {
  location_id: string;
  provider_id: string;
  operatory_id: string;
  appointment_type_id: string;
  timezone: string;
  duration: number;
}
interface Offer extends Candidate {
  id: string;
  starts_at: Date;
  ends_at: Date;
}
interface Row {
  id: string;
  patient_id: string;
  provider_id: string | null;
  appointment_type_id: string;
  status: AppointmentState;
  revision: number;
  starts_at: Date;
  ends_at: Date;
  timezone: string;
  location_name: string;
  provider_name: string | null;
  operatory_name: string | null;
  type_name: string;
  patient_name: string;
}
interface Hours {
  provider_id: string | null;
  weekday: number;
  opens_at_local: string;
  closes_at_local: string;
  location_id: string;
  valid_from: string | null;
  valid_through: string | null;
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const administrators = ['clinic_owner', 'clinic_admin'] as const;
const has = (access: Access, roles: readonly ClinicRole[]) =>
  access.roles.some((role) => roles.includes(role));
const staff = (access: Access) =>
  has(access, ['clinic_owner', 'clinic_admin', 'dentist', 'receptionist']);
const dentistOnly = (access: Access) =>
  !has(access, ['clinic_owner', 'clinic_admin', 'receptionist']) && has(access, ['dentist']);
const notFound = () => new DomainError('NOT_FOUND', 'Appointment or resource not found.', 404);
const denied = () => new DomainError('ACCESS_DENIED', 'Scheduling access denied.', 403);
const selectRow = `SELECT a.*,l.name AS location_name,u.display_name AS provider_name,o.name AS operatory_name,t.name AS type_name,
 concat_ws(' ',p.given_name,p.family_name) AS patient_name FROM appointments a
 JOIN locations l ON l.id=a.location_id AND l.clinic_id=a.clinic_id JOIN patients p ON p.id=a.patient_id AND p.clinic_id=a.clinic_id
 JOIN appointment_types t ON t.id=a.appointment_type_id AND t.clinic_id=a.clinic_id
 LEFT JOIN operatories o ON o.id=a.operatory_id AND o.clinic_id=a.clinic_id
 LEFT JOIN providers v ON v.id=a.provider_id AND v.clinic_id=a.clinic_id LEFT JOIN staff s ON s.id=v.staff_id AND s.clinic_id=a.clinic_id
 LEFT JOIN memberships m ON m.id=s.membership_id AND m.clinic_id=a.clinic_id LEFT JOIN users u ON u.id=m.user_id`;

export class SchedulingRepository {
  constructor(readonly pool: Pool) {}
  private async access(context: AccessContext, db: Queryable): Promise<Access> {
    if (!context.membership) throw denied();
    const result = await db.query<{ key: ClinicRole }>(
      `SELECT r.key FROM memberships m JOIN clinics c ON c.id=m.clinic_id AND c.active
   JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL JOIN auth_sessions s ON s.user_id=u.id AND s.id=$3 AND s.expires_at>now()
   JOIN membership_roles mr ON mr.clinic_id=m.clinic_id AND mr.membership_id=m.id JOIN roles r ON r.id=mr.role_id AND r.clinic_id=m.clinic_id
   WHERE m.id=$1 AND m.user_id=$2 AND m.clinic_id=$4 AND m.status='active' AND (s.active_membership_id IS NULL OR s.active_membership_id=m.id) ${db === this.pool ? '' : 'FOR SHARE OF m,c,u,s,mr,r'}`,
      [context.membership.id, context.userId, context.sessionId, context.membership.clinicId],
    );
    if (!result.rowCount) throw denied();
    return {
      ...context,
      clinicId: context.membership.clinicId,
      membershipId: context.membership.id,
      roles: result.rows.map((row) => row.key),
    };
  }
  private async transaction<T>(
    context: AccessContext,
    operation: (db: PoolClient, access: Access) => Promise<T>,
  ): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      if (!context.membership) throw denied();
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('scheduling:'||$1,0))", [
        context.membership.clinicId,
      ]);
      await db.query("SELECT set_config('dentalai.request_id',$1,true)", [context.requestId]);
      const access = await this.access(context, db);
      const result = await operation(db, access);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code === '23P01' || code === '40P01')
        throw new DomainError(
          'SLOT_UNAVAILABLE',
          'That time is no longer available. Search again.',
          409,
        );
      if (code === '23505')
        throw new DomainError('CONFLICT', 'A scheduling entry already exists.', 409);
      if (code === '23514')
        throw new DomainError(
          'INVALID_TRANSITION',
          'The appointment or scheduling change is not permitted.',
          422,
        );
      if (code === '23503') throw notFound();
      throw error;
    } finally {
      db.release();
    }
  }
  private scope(access: Access): { sql: string; values: unknown[] } {
    if (!staff(access)) return { sql: 'AND p.portal_user_id=$2', values: [access.userId] };
    if (dentistOnly(access))
      return { sql: 'AND s.membership_id=$2', values: [access.membershipId] };
    return { sql: '', values: [] };
  }
  private dto(row: Row, access: Access): Appointment {
    return AppointmentSchema.parse({
      id: row.id,
      appointmentTypeId: row.appointment_type_id,
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
      timezone: row.timezone,
      status: row.status,
      revision: row.revision,
      locationName: row.location_name,
      providerName: row.provider_name,
      operatoryName: row.operatory_name,
      typeName: row.type_name,
      ...(staff(access) ? { patientId: row.patient_id, patientName: row.patient_name } : {}),
    });
  }
  private async row(db: Queryable, access: Access, id: string, lock = false): Promise<Row> {
    const scope = this.scope(access);
    const values = [access.clinicId, ...scope.values, id];
    const result = await db.query<Row>(
      `${selectRow} WHERE a.clinic_id=$1 ${scope.sql} AND a.id=$${values.length} ${lock ? 'FOR UPDATE OF a FOR SHARE OF p' : ''}`,
      values,
    );
    if (!result.rows[0]) throw notFound();
    return result.rows[0];
  }
  async get(context: AccessContext, id: string) {
    const access = await this.access(context, this.pool);
    return this.dto(await this.row(this.pool, access, id), access);
  }
  async list(context: AccessContext, query: z.infer<typeof AppointmentListQuerySchema>) {
    const access = await this.access(context, this.pool);
    const scope = this.scope(access);
    const values: unknown[] = [access.clinicId, ...scope.values];
    const filter =
      query.view === 'upcoming'
        ? "a.ends_at>now() AND a.status NOT IN ('completed','cancelled','no_show')"
        : "(a.ends_at<=now() OR a.status IN ('completed','cancelled','no_show'))";
    let dateFilter = '';
    if (query.date) {
      values.push(query.date);
      dateFilter = `AND (a.starts_at AT TIME ZONE a.timezone)::date=$${values.length}::date`;
    }
    values.push(query.limit + 1, query.offset);
    const result = await this.pool.query<Row>(
      `${selectRow} WHERE a.clinic_id=$1 ${scope.sql} AND ${filter} ${dateFilter} ORDER BY a.starts_at ${query.view === 'history' ? 'DESC' : 'ASC'},a.id LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      items: result.rows.slice(0, query.limit).map((row) => this.dto(row, access)),
      nextOffset: result.rows.length > query.limit ? query.offset + query.limit : null,
    };
  }
  async history(context: AccessContext, id: string) {
    const access = await this.access(context, this.pool);
    await this.row(this.pool, access, id);
    const result = await this.pool.query<{
      action: string;
      occurred_at: Date;
      data: { before: Record<string, unknown> | null; after: Record<string, unknown> };
    }>(
      "SELECT action,occurred_at,data FROM audit_events WHERE clinic_id=$1 AND entity_type='appointment' AND entity_id=$2 ORDER BY occurred_at,id",
      [access.clinicId, id],
    );
    return result.rows.map((row) => ({
      action: row.action,
      occurredAt: row.occurred_at.toISOString(),
      before: row.data.before,
      after: row.data.after,
    }));
  }
  async catalog(context: AccessContext) {
    const access = await this.access(context, this.pool);
    const clinic = await this.pool.query<{ default_timezone: string }>(
      'SELECT default_timezone FROM clinics WHERE id=$1',
      [access.clinicId],
    );
    const locations = await this.pool.query(
      'SELECT id,name,timezone FROM locations WHERE clinic_id=$1 AND active ORDER BY name,id',
      [access.clinicId],
    );
    const types = await this.pool.query(
      'SELECT id,name,default_duration_minutes AS "durationMinutes" FROM appointment_types WHERE clinic_id=$1 AND active ORDER BY name,id',
      [access.clinicId],
    );
    const providers = await this.pool.query(
      `SELECT v.id,u.display_name AS name FROM providers v JOIN staff s ON s.id=v.staff_id AND s.clinic_id=v.clinic_id AND s.active JOIN memberships m ON m.id=s.membership_id AND m.clinic_id=s.clinic_id AND m.status='active' JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL WHERE v.clinic_id=$1 AND v.active ORDER BY u.display_name,v.id`,
      [access.clinicId],
    );
    const operatories = await this.pool.query(
      'SELECT id,location_id AS "locationId",name FROM operatories WHERE clinic_id=$1 AND active ORDER BY name,id',
      [access.clinicId],
    );
    const hours = await this.pool.query(
      'SELECT id,location_id AS "locationId",provider_id AS "providerId",weekday,opens_at_local::text AS "opensAt",closes_at_local::text AS "closesAt" FROM working_hours WHERE clinic_id=$1 ORDER BY weekday,opens_at_local,id',
      [access.clinicId],
    );
    const closures = await this.pool.query<{
      id: string;
      locationId: string | null;
      starts_at: Date;
      ends_at: Date;
      reason: string;
    }>(
      'SELECT id,location_id AS "locationId",starts_at,ends_at,reason FROM clinic_closures WHERE clinic_id=$1 AND active ORDER BY starts_at,id',
      [access.clinicId],
    );
    const policy = await this.policy(this.pool, access.clinicId);
    return SchedulingCatalogSchema.parse({
      clinicTimezone: clinic.rows[0]?.default_timezone,
      locations: locations.rows,
      types: types.rows,
      providers: staff(access) ? providers.rows : [],
      operatories: staff(access) ? operatories.rows : [],
      hours: staff(access) ? hours.rows : [],
      closures: staff(access)
        ? closures.rows.map((row) => ({
            id: row.id,
            locationId: row.locationId,
            startsAt: row.starts_at.toISOString(),
            endsAt: row.ends_at.toISOString(),
            reason: row.reason,
          }))
        : [],
      policy,
    });
  }
  private async policy(db: Queryable, clinicId: string) {
    const result = await db.query<{ leadMinutes: number; horizonDays: number }>(
      'SELECT appointment_lead_minutes AS "leadMinutes",appointment_horizon_days AS "horizonDays" FROM clinic_settings WHERE clinic_id=$1',
      [clinicId],
    );
    return result.rows[0] ?? { leadMinutes: 0, horizonDays: 365 };
  }
  private async candidates(
    db: Queryable,
    access: Access,
    locationId: string,
    typeId: string,
  ): Promise<Candidate[]> {
    const result = await db.query<Candidate>(
      `SELECT l.id AS location_id,l.timezone,v.id AS provider_id,o.id AS operatory_id,t.id AS appointment_type_id,t.default_duration_minutes AS duration
   FROM locations l JOIN operatories o ON o.clinic_id=l.clinic_id AND o.location_id=l.id AND o.active
   JOIN appointment_types t ON t.clinic_id=l.clinic_id AND t.id=$3 AND t.active
   JOIN providers v ON v.clinic_id=l.clinic_id AND v.active JOIN staff s ON s.id=v.staff_id AND s.clinic_id=v.clinic_id AND s.active
   JOIN memberships m ON m.id=s.membership_id AND m.clinic_id=s.clinic_id AND m.status='active' JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL
   WHERE l.clinic_id=$1 AND l.id=$2 AND l.active AND ($4::uuid IS NULL OR s.membership_id=$4)
   AND EXISTS(SELECT 1 FROM membership_roles mr JOIN roles r ON r.id=mr.role_id AND r.clinic_id=mr.clinic_id WHERE mr.clinic_id=m.clinic_id AND mr.membership_id=m.id AND r.key='dentist') ORDER BY v.id,o.id ${db === this.pool ? '' : 'FOR SHARE OF l,o,t,v,s,m,u'}`,
      [access.clinicId, locationId, typeId, dentistOnly(access) ? access.membershipId : null],
    );
    return result.rows;
  }
  private async hours(db: Queryable, access: Access): Promise<Hours[]> {
    return (
      await db.query<Hours>(
        'SELECT provider_id,weekday,opens_at_local::text,closes_at_local::text,location_id,valid_from::text,valid_through::text FROM working_hours WHERE clinic_id=$1 ORDER BY opens_at_local',
        [access.clinicId],
      )
    ).rows;
  }
  private slots(candidate: Candidate, date: string, hours: Hours[]) {
    const valid = (row: Hours) =>
      row.location_id === candidate.location_id &&
      row.weekday === weekday(date) &&
      (!row.valid_from || row.valid_from <= date) &&
      (!row.valid_through || row.valid_through >= date);
    const general = hours.filter((row) => row.provider_id === null && valid(row));
    const specific = hours.filter((row) => row.provider_id === candidate.provider_id && valid(row));
    const hasProviderSchedule = hours.some((row) => row.provider_id === candidate.provider_id);
    return general
      .flatMap((row) =>
        wallClockSlots(
          date,
          candidate.timezone,
          row.opens_at_local,
          row.closes_at_local,
          candidate.duration,
        ),
      )
      .filter(
        (slot) =>
          !hasProviderSchedule ||
          specific.some((row) =>
            wallClockSlots(
              date,
              candidate.timezone,
              row.opens_at_local,
              row.closes_at_local,
              candidate.duration,
            ).some((value) => value.startsAt === slot.startsAt && value.endsAt === slot.endsAt),
          ),
      );
  }
  private async free(
    db: Queryable,
    access: Access,
    candidate: Candidate,
    start: string,
    end: string,
    ignore: string | null = null,
  ): Promise<boolean> {
    const result = await db.query<{ free: boolean }>(
      `SELECT NOT EXISTS(SELECT 1 FROM appointments a WHERE a.clinic_id=$1 AND a.status NOT IN ('cancelled','no_show') AND ($7::uuid IS NULL OR a.id<>$7) AND (a.provider_id=$2 OR a.operatory_id=$3) AND tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange($4::timestamptz,$5::timestamptz,'[)'))
   AND NOT EXISTS(SELECT 1 FROM schedule_blocks b WHERE b.clinic_id=$1 AND (b.provider_id=$2 OR b.operatory_id=$3) AND tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange($4::timestamptz,$5::timestamptz,'[)'))
   AND NOT EXISTS(SELECT 1 FROM clinic_closures c WHERE c.clinic_id=$1 AND c.active AND (c.location_id IS NULL OR c.location_id=$6) AND tstzrange(c.starts_at,c.ends_at,'[)') && tstzrange($4::timestamptz,$5::timestamptz,'[)')) AS free`,
      [
        access.clinicId,
        candidate.provider_id,
        candidate.operatory_id,
        start,
        end,
        candidate.location_id,
        ignore,
      ],
    );
    return result.rows[0]?.free === true;
  }
  async availability(context: AccessContext, query: z.infer<typeof AvailabilityQuerySchema>) {
    const access = await this.access(context, this.pool);
    const location = await this.pool.query<{ timezone: string }>(
      'SELECT timezone FROM locations WHERE clinic_id=$1 AND id=$2 AND active',
      [access.clinicId, query.locationId],
    );
    const timezone = location.rows[0]?.timezone;
    if (!timezone) throw notFound();
    const type = await this.pool.query(
      'SELECT 1 FROM appointment_types WHERE clinic_id=$1 AND id=$2 AND active',
      [access.clinicId, query.appointmentTypeId],
    );
    if (!type.rowCount) throw notFound();
    const policy = await this.policy(this.pool, access.clinicId);
    const now = new Date();
    const distance = calendarDateDistance(dateInZone(now.toISOString(), timezone), query.date);
    if (distance < 0 || distance > policy.horizonDays)
      throw new DomainError(
        'OUTSIDE_BOOKING_WINDOW',
        'Choose a date within the clinic booking window.',
        422,
      );
    const candidates = await this.candidates(
      this.pool,
      access,
      query.locationId,
      query.appointmentTypeId,
    );
    const hours = await this.hours(this.pool, access);
    const expiresAt = new Date(now.getTime() + 5 * 60000);
    const selected = new Map<
      string,
      { token: string; startsAt: string; endsAt: string; timezone: string }
    >();
    for (const candidate of candidates) {
      for (const slot of this.slots(candidate, query.date, hours)) {
        if (
          selected.size >= 100 ||
          selected.has(slot.startsAt) ||
          Date.parse(slot.startsAt) <= now.getTime() + policy.leadMinutes * 60000
        )
          continue;
        if (!(await this.free(this.pool, access, candidate, slot.startsAt, slot.endsAt))) continue;
        const token = randomBytes(32).toString('hex');
        await this.pool.query(
          'INSERT INTO appointment_slot_offers(clinic_id,user_id,token_hash,location_id,provider_id,operatory_id,appointment_type_id,starts_at,ends_at,timezone,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            access.clinicId,
            access.userId,
            digest(token),
            candidate.location_id,
            candidate.provider_id,
            candidate.operatory_id,
            candidate.appointment_type_id,
            slot.startsAt,
            slot.endsAt,
            candidate.timezone,
            expiresAt,
          ],
        );
        selected.set(slot.startsAt, { token, ...slot, timezone });
      }
    }
    return {
      slots: [...selected.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      expiresAt: expiresAt.toISOString(),
      timezone,
    };
  }
  private async offer(db: PoolClient, access: Access, token: string): Promise<Offer> {
    const result = await db.query<Offer>(
      'SELECT * FROM appointment_slot_offers WHERE token_hash=$1 AND clinic_id=$2 AND user_id=$3 AND expires_at>now() AND consumed_at IS NULL FOR UPDATE',
      [digest(token), access.clinicId, access.userId],
    );
    const offer = result.rows[0];
    if (!offer)
      throw new DomainError(
        'SLOT_EXPIRED',
        'This slot expired or is unavailable. Search again.',
        409,
      );
    const candidates = await this.candidates(
      db,
      access,
      offer.location_id,
      offer.appointment_type_id,
    );
    const candidate = candidates.find(
      (row) => row.provider_id === offer.provider_id && row.operatory_id === offer.operatory_id,
    );
    if (!candidate)
      throw new DomainError(
        'SLOT_UNAVAILABLE',
        'The scheduling resources changed. Search again.',
        409,
      );
    const policy = await this.policy(db, access.clinicId);
    const date = dateInZone(offer.starts_at.toISOString(), candidate.timezone);
    const distance = calendarDateDistance(
      dateInZone(new Date().toISOString(), candidate.timezone),
      date,
    );
    if (
      offer.starts_at.getTime() <= Date.now() + policy.leadMinutes * 60000 ||
      distance > policy.horizonDays ||
      candidate.timezone !== offer.timezone ||
      !this.slots(candidate, date, await this.hours(db, access)).some(
        (slot) =>
          Date.parse(slot.startsAt) === offer.starts_at.getTime() &&
          Date.parse(slot.endsAt) === offer.ends_at.getTime(),
      )
    )
      throw new DomainError('SLOT_UNAVAILABLE', 'The scheduling rules changed. Search again.', 409);
    return { ...offer, duration: candidate.duration };
  }
  async book(context: AccessContext, token: string, patientSelector?: string) {
    return this.transaction(context, async (db, access) => {
      if (patientSelector && !staff(access)) throw denied();
      const patient = await db.query<{ id: string }>(
        'SELECT id FROM patients WHERE clinic_id=$1 AND archived_at IS NULL AND (($3::boolean AND id=$2::uuid) OR (NOT $3::boolean AND portal_user_id=$4)) FOR SHARE',
        [access.clinicId, patientSelector ?? null, !!patientSelector, access.userId],
      );
      const patientId = patient.rows[0]?.id;
      if (!patientId)
        throw new DomainError(
          'PATIENT_NOT_LINKED',
          'A permitted patient record must be linked by the clinic before booking.',
          patientSelector ? 404 : 403,
        );
      const offer = await this.offer(db, access, token);
      const result = await db.query<{ id: string }>(
        `INSERT INTO appointments(clinic_id,patient_id,location_id,provider_id,operatory_id,appointment_type_id,starts_at,ends_at,timezone,status,created_by_membership_id,last_changed_by_membership_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'scheduled',$10,$10) RETURNING id`,
        [
          access.clinicId,
          patientId,
          offer.location_id,
          offer.provider_id,
          offer.operatory_id,
          offer.appointment_type_id,
          offer.starts_at,
          offer.ends_at,
          offer.timezone,
          access.membershipId,
        ],
      );
      await db.query('UPDATE appointment_slot_offers SET consumed_at=now() WHERE id=$1', [
        offer.id,
      ]);
      return this.dto(await this.row(db, access, result.rows[0]!.id), access);
    });
  }
  async action(context: AccessContext, id: string, body: z.infer<typeof AppointmentActionSchema>) {
    return this.transaction(context, async (db, access) => {
      const row = await this.row(db, access, id, true);
      if (row.revision !== body.revision)
        throw new DomainError(
          'STALE_APPOINTMENT',
          'The appointment changed. Refresh and try again.',
          409,
        );
      if (!staff(access) && body.action !== 'cancel') throw denied();
      if (
        ['complete', 'start'].includes(body.action) &&
        !has(access, ['clinic_owner', 'clinic_admin', 'dentist'])
      )
        throw denied();
      const target = actionTargets[body.action];
      if (!canTransition(row.status, target))
        throw new DomainError(
          'INVALID_TRANSITION',
          'That status transition is not permitted.',
          422,
        );
      if (['cancel', 'no_show'].includes(body.action) && !body.reason)
        throw new DomainError('REASON_REQUIRED', 'Enter a reason for this change.', 400);
      const now = Date.now();
      if (
        (!staff(access) && row.starts_at.getTime() <= now) ||
        (body.action === 'confirm' && row.starts_at.getTime() <= now) ||
        (body.action === 'complete' && row.ends_at.getTime() > now) ||
        (['no_show', 'start'].includes(body.action) && row.starts_at.getTime() > now) ||
        (body.action === 'check_in' && row.starts_at.getTime() > now + 15 * 60000)
      )
        throw new DomainError(
          'INVALID_TRANSITION',
          'This action is not allowed at this appointment time.',
          422,
        );
      await db.query(
        `UPDATE appointments SET status=$1::appointment_status,last_changed_by_membership_id=$2::uuid,cancelled_at=CASE WHEN $1::appointment_status IN ('cancelled','no_show') THEN now() ELSE cancelled_at END,cancelled_by_membership_id=CASE WHEN $1::appointment_status IN ('cancelled','no_show') THEN $2::uuid ELSE cancelled_by_membership_id END,cancellation_reason=CASE WHEN $1::appointment_status IN ('cancelled','no_show') THEN $3::text ELSE cancellation_reason END WHERE id=$4 AND clinic_id=$5`,
        [target, access.membershipId, body.reason ?? null, id, access.clinicId],
      );
      return this.dto(await this.row(db, access, id), access);
    });
  }
  async reschedule(context: AccessContext, id: string, token: string, revision: number) {
    return this.transaction(context, async (db, access) => {
      const row = await this.row(db, access, id, true);
      if (row.revision !== revision)
        throw new DomainError(
          'STALE_APPOINTMENT',
          'The appointment changed. Refresh and try again.',
          409,
        );
      if (!['scheduled', 'confirmed'].includes(row.status) || row.starts_at.getTime() <= Date.now())
        throw new DomainError(
          'INVALID_TRANSITION',
          'Only an upcoming appointment may be rescheduled.',
          422,
        );
      const offer = await this.offer(db, access, token);
      if (offer.appointment_type_id !== row.appointment_type_id)
        throw new DomainError(
          'INVALID_TARGET',
          'Rescheduling must retain the appointment type.',
          422,
        );
      if (offer.starts_at.getTime() === row.starts_at.getTime())
        throw new DomainError('INVALID_TARGET', 'Choose a different appointment time.', 422);
      await db.query(
        "UPDATE appointments SET starts_at=$1,ends_at=$2,location_id=$3,provider_id=$4,operatory_id=$5,timezone=$6,status='scheduled',last_changed_by_membership_id=$7 WHERE id=$8 AND clinic_id=$9",
        [
          offer.starts_at,
          offer.ends_at,
          offer.location_id,
          offer.provider_id,
          offer.operatory_id,
          offer.timezone,
          access.membershipId,
          id,
          access.clinicId,
        ],
      );
      await db.query('UPDATE appointment_slot_offers SET consumed_at=now() WHERE id=$1', [
        offer.id,
      ]);
      return this.dto(await this.row(db, access, id), access);
    });
  }
  async configure(
    context: AccessContext,
    kind: 'operatory' | 'type' | 'hour' | 'closure' | 'policy',
    body:
      | z.infer<typeof OperatoryInputSchema>
      | z.infer<typeof TypeInputSchema>
      | z.infer<typeof HourInputSchema>
      | z.infer<typeof ClosureInputSchema>
      | z.infer<typeof SchedulingPolicySchema>,
  ) {
    return this.transaction(context, async (db, access) => {
      if (!has(access, administrators)) throw denied();
      if ('locationId' in body && body.locationId) {
        const location = await db.query(
          'SELECT 1 FROM locations WHERE id=$1 AND clinic_id=$2 AND active',
          [body.locationId, access.clinicId],
        );
        if (!location.rowCount) throw notFound();
      }
      if (kind === 'operatory' && 'name' in body && 'locationId' in body)
        await db.query('INSERT INTO operatories(clinic_id,location_id,name) VALUES($1,$2,$3)', [
          access.clinicId,
          body.locationId,
          body.name,
        ]);
      else if (kind === 'type' && 'code' in body)
        await db.query(
          'INSERT INTO appointment_types(clinic_id,name,code,default_duration_minutes) VALUES($1,$2,$3,$4)',
          [access.clinicId, body.name, body.code, body.durationMinutes],
        );
      else if (kind === 'hour' && 'weekday' in body) {
        if (body.providerId) {
          const provider = await db.query(
            'SELECT 1 FROM providers WHERE clinic_id=$1 AND id=$2 AND active',
            [access.clinicId, body.providerId],
          );
          if (!provider.rowCount) throw notFound();
        }
        await db.query(
          'INSERT INTO working_hours(clinic_id,location_id,provider_id,weekday,opens_at_local,closes_at_local) VALUES($1,$2,$3,$4,$5,$6)',
          [
            access.clinicId,
            body.locationId,
            body.providerId,
            body.weekday,
            body.opensAt,
            body.closesAt,
          ],
        );
      } else if (kind === 'closure' && 'startsAt' in body) {
        if (Date.parse(body.startsAt) < Date.now())
          throw new DomainError('INVALID_CLOSURE', 'A new closure must begin in the future.', 422);
        await db.query(
          'INSERT INTO clinic_closures(clinic_id,location_id,starts_at,ends_at,reason) VALUES($1,$2,$3,$4,$5)',
          [access.clinicId, body.locationId, body.startsAt, body.endsAt, body.reason],
        );
      } else if (kind === 'policy' && 'leadMinutes' in body)
        await db.query(
          'INSERT INTO clinic_settings(clinic_id,appointment_lead_minutes,appointment_horizon_days) VALUES($1,$2,$3) ON CONFLICT(clinic_id) DO UPDATE SET appointment_lead_minutes=$2,appointment_horizon_days=$3',
          [access.clinicId, body.leadMinutes, body.horizonDays],
        );
      else throw new DomainError('INVALID_REQUEST', 'Invalid scheduling configuration.', 400);
      await db.query(
        "INSERT INTO audit_events(clinic_id,actor_user_id,actor_membership_id,action,entity_type,request_id,data) VALUES($1,$2,$3,$4,'scheduling',$5,$6)",
        [
          access.clinicId,
          access.userId,
          access.membershipId,
          `scheduling.${kind}.changed`,
          access.requestId,
          JSON.stringify(body),
        ],
      );
      return { success: true as const };
    });
  }
  async removeConfiguration(context: AccessContext, kind: 'hour' | 'closure', id: string) {
    return this.transaction(context, async (db, access) => {
      if (!has(access, administrators)) throw denied();
      const result =
        kind === 'hour'
          ? await db.query('DELETE FROM working_hours WHERE clinic_id=$1 AND id=$2 RETURNING id', [
              access.clinicId,
              id,
            ])
          : await db.query(
              'UPDATE clinic_closures SET active=false WHERE clinic_id=$1 AND id=$2 AND active RETURNING id',
              [access.clinicId, id],
            );
      if (!result.rowCount) throw notFound();
      await db.query(
        "INSERT INTO audit_events(clinic_id,actor_user_id,actor_membership_id,action,entity_type,entity_id,request_id) VALUES($1,$2,$3,$4,'scheduling',$5,$6)",
        [
          access.clinicId,
          access.userId,
          access.membershipId,
          `scheduling.${kind}.removed`,
          id,
          access.requestId,
        ],
      );
      return { success: true as const };
    });
  }
}
