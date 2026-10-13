import { randomBytes } from 'node:crypto';
import {
  SchedulingCatalogSchema,
  type AvailabilityQuerySchema,
  type AppointmentListQuerySchema,
} from '@dentalai/contracts';
import { calendarDateDistance, dateInZone } from '@dentalai/domain';
import type { z } from 'zod';
import type { AccessContext } from '../access/access.repository.js';
import { DomainError } from '../../errors/domain-errors.js';
import { Row, digest, staff, notFound, selectRow } from './scheduling-shared.js';
import { SchedulingCore } from './scheduling-core.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class SchedulingReadRepository extends SchedulingCore {
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
}
