import type { Pool, PoolClient } from 'pg';
import { AppointmentSchema, type Appointment, type ClinicRole } from '@dentalai/contracts';
import {
  calendarDateDistance,
  dateInZone,
  localWallTimeToInstant,
  weekday,
  wallClockSlots,
} from '@dentalai/domain';
import type { AccessContext } from '../access/access.repository.js';
import { DomainError } from '../../errors/domain-errors.js';
import {
  Access,
  Queryable,
  Candidate,
  Offer,
  Row,
  Hours,
  digest,
  staff,
  dentistOnly,
  notFound,
  denied,
  selectRow,
} from './scheduling-shared.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class SchedulingCore {
  constructor(readonly pool: Pool) {}
  protected async access(context: AccessContext, db: Queryable): Promise<Access> {
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
  protected async transaction<T>(
    context: AccessContext,
    operation: (db: PoolClient, access: Access) => Promise<T>,
  ): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      if (!context.membership) throw denied();
      await db.query('SELECT saas_lock($1)', [context.membership.clinicId]);
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
  protected scope(access: Access): { sql: string; values: unknown[] } {
    if (!staff(access)) return { sql: 'AND p.portal_user_id=$2', values: [access.userId] };
    if (dentistOnly(access))
      return { sql: 'AND s.membership_id=$2', values: [access.membershipId] };
    return { sql: '', values: [] };
  }
  protected dto(row: Row, access: Access): Appointment {
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
  protected async row(db: Queryable, access: Access, id: string, lock = false): Promise<Row> {
    const scope = this.scope(access);
    const values = [access.clinicId, ...scope.values, id];
    const result = await db.query<Row>(
      `${selectRow} WHERE a.clinic_id=$1 ${scope.sql} AND a.id=$${values.length} ${lock ? 'FOR UPDATE OF a FOR SHARE OF p' : ''}`,
      values,
    );
    if (!result.rows[0]) throw notFound();
    return result.rows[0];
  }
  protected async policy(db: Queryable, clinicId: string) {
    const result = await db.query<{ leadMinutes: number; horizonDays: number }>(
      'SELECT appointment_lead_minutes AS "leadMinutes",appointment_horizon_days AS "horizonDays" FROM clinic_settings WHERE clinic_id=$1',
      [clinicId],
    );
    return result.rows[0] ?? { leadMinutes: 0, horizonDays: 365 };
  }
  protected async candidates(
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
  protected async hours(db: Queryable, access: Access): Promise<Hours[]> {
    return (
      await db.query<Hours>(
        'SELECT provider_id,weekday,opens_at_local::text,closes_at_local::text,location_id,valid_from::text,valid_through::text FROM working_hours WHERE clinic_id=$1 ORDER BY opens_at_local',
        [access.clinicId],
      )
    ).rows;
  }
  protected slots(candidate: Candidate, date: string, hours: Hours[]) {
    const valid = (row: Hours) =>
      row.location_id === candidate.location_id &&
      row.weekday === weekday(date) &&
      (!row.valid_from || row.valid_from <= date) &&
      (!row.valid_through || row.valid_through >= date);
    const general = hours.filter((row) => row.provider_id === null && valid(row));
    const specific = hours.filter((row) => row.provider_id === candidate.provider_id && valid(row));
    const hasProviderSchedule = hours.some((row) => row.provider_id === candidate.provider_id);
    const providerWindows = specific.flatMap((row) => {
      try {
        return [
          {
            startsAt: Date.parse(
              localWallTimeToInstant(`${date}T${row.opens_at_local}`, candidate.timezone),
            ),
            endsAt: Date.parse(
              localWallTimeToInstant(`${date}T${row.closes_at_local}`, candidate.timezone),
            ),
          },
        ];
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        return []; // Ambiguous/nonexistent DST boundaries are conservatively unavailable.
      }
    });
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
          providerWindows.some(
            (window) =>
              Date.parse(slot.startsAt) >= window.startsAt &&
              Date.parse(slot.endsAt) <= window.endsAt,
          ),
      );
  }
  protected async free(
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
  protected async offer(db: PoolClient, access: Access, token: string): Promise<Offer> {
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
}
