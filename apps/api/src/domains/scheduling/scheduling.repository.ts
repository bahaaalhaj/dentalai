import {
  type AppointmentActionSchema,
  type HourInputSchema,
  type ClosureInputSchema,
  type OperatoryInputSchema,
  type TypeInputSchema,
  type SchedulingPolicySchema,
} from '@dentalai/contracts';
import { actionTargets, canTransition } from '@dentalai/domain';
import type { z } from 'zod';
import type { AccessContext } from '../access/access.repository.js';
import { DomainError } from '../../errors/domain-errors.js';
import { administrators, has, staff, notFound, denied } from './scheduling-shared.js';
import { SchedulingReadRepository } from './scheduling-read.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class SchedulingRepository extends SchedulingReadRepository {
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
