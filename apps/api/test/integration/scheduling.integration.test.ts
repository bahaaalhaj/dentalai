import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AvailabilitySchema,
  AppointmentSchema,
  AppointmentListSchema,
  AppointmentHistorySchema,
} from '@dentalai/contracts';
import { clinicToday, calendarDateDistance } from '@dentalai/domain';
import { createSchedulingFixture, mutation } from '../support/scheduling-fixture.js';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL must be a disposable PostgreSQL instance.');
let f: Awaited<ReturnType<typeof createSchedulingFixture>>;
const day = '2030-01-07'; // Fixture expands booking horizon explicitly; current UI tests use tomorrow.
beforeAll(async () => {
  f = await createSchedulingFixture(url);
  await f.database.pool.query(
    'INSERT INTO clinic_settings(clinic_id,appointment_horizon_days) VALUES($1,3650)',
    [f.clinicId],
  );
});
afterAll(async () => {
  if (f) await f.dispose();
});
beforeEach(async () => {
  await f.database.pool.query('DELETE FROM auth_rate_limits');
});
const user = (role: string) => f.members[role]!;
async function slots(role = 'patient', date = day) {
  const result = await request(f.app)
    .get(
      `/api/v1/scheduling/availability?locationId=${f.locationId}&appointmentTypeId=${f.typeId}&date=${date}`,
    )
    .set('cookie', user(role).cookie)
    .expect(200);
  return AvailabilitySchema.parse(result.body).slots;
}
async function book(role = 'patient', index = 0, date = day) {
  const slot = (await slots(role, date))[index];
  expect(slot).toBeDefined();
  const response = await mutation(
    f.app,
    f.origin,
    '/api/v1/appointments',
    { slotToken: slot!.token },
    user(role).cookie,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return AppointmentSchema.parse(response.body);
}
async function action(role: string, id: string, revision: number, name: string) {
  return mutation(
    f.app,
    f.origin,
    `/api/v1/appointments/${id}/actions`,
    { action: name, revision, reason: 'Fictional test reason' },
    user(role).cookie,
  );
}

describe('PostgreSQL appointment API integrity', () => {
  it('intersects provider hours with the clinic grid even when opening times are misaligned', async () => {
    const hours = await f.database.pool.query<{ id: string }>(
      "INSERT INTO working_hours(clinic_id,location_id,provider_id,weekday,opens_at_local,closes_at_local) VALUES($1,$2,$3,1,'09:10','10:40') RETURNING id",
      [f.clinicId, f.locationId, f.providerId],
    );
    try {
      const available = await slots('patient', '2030-02-11');
      expect(available.length).toBeGreaterThan(0);
      expect(available[0]?.startsAt).toBe('2030-02-11T06:15:00Z');
      expect(available.every((slot) => slot.endsAt <= '2030-02-11T07:40:00Z')).toBe(true);
      await book('patient', 0, '2030-02-11');
    } finally {
      await f.database.pool.query('DELETE FROM working_hours WHERE id=$1', [hours.rows[0]!.id]);
    }
  });
  it('retains cancellation reasons and rejects rewriting terminal or creation provenance', async () => {
    const booked = await book('patient', 0, '2030-02-12');
    expect((await action('patient', booked.id, 0, 'cancel')).status).toBe(200);
    const event = (
      await f.database.pool.query<{ data: { after: { reason: string } } }>(
        "SELECT data FROM audit_events WHERE entity_id=$1 AND action='appointment.cancelled'",
        [booked.id],
      )
    ).rows[0];
    expect(event?.data.after.reason).toBe('Fictional test reason');
    await expect(
      f.database.pool.query("UPDATE appointments SET cancellation_reason='rewritten' WHERE id=$1", [
        booked.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      f.database.pool.query('UPDATE appointments SET created_by_membership_id=$1 WHERE id=$2', [
        user('receptionist').membershipId,
        booked.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('requires authentication and hides private scheduling configuration from patients', async () => {
    await request(f.app).get('/api/v1/appointments').expect(401);
    await request(f.app).get('/api/v1/scheduling/catalog').expect(401);
    const response = await request(f.app)
      .get('/api/v1/scheduling/catalog')
      .set('cookie', user('patient').cookie)
      .expect(200);
    expect(response.body.providers).toEqual([]);
    expect(response.body.operatories).toEqual([]);
    expect(response.body.hours).toEqual([]);
    expect(response.body.closures).toEqual([]);
    const foreign = AppointmentListSchema.parse(
      (
        await request(f.app)
          .get('/api/v1/appointments')
          .set('cookie', user('foreign').cookie)
          .expect(200)
      ).body,
    );
    expect(foreign.items).toEqual([]);
  });
  it.each(['clinic_owner', 'clinic_admin', 'dentist', 'receptionist'])(
    'permits %s to book for a clinic patient, never a browser-selected provider/status',
    async (role) => {
      const offer = (await slots(role, '2030-02-07'))[0]!;
      const response = await mutation(
        f.app,
        f.origin,
        '/api/v1/appointments/staff',
        { slotToken: offer.token, patientId: f.secondPatientId },
        user(role).cookie,
      );
      expect(response.status).toBe(200);
      const booked = AppointmentSchema.parse(response.body);
      expect(booked.status).toBe('scheduled');
      expect(booked.patientId).toBe(f.secondPatientId);
      expect(
        (
          await mutation(
            f.app,
            f.origin,
            '/api/v1/appointments/staff',
            {
              slotToken: offer.token,
              patientId: f.patientId,
              providerId: f.providerId,
              status: 'confirmed',
            },
            user(role).cookie,
          )
        ).status,
      ).toBe(400);
    },
  );
  it('returns only anonymized offers and rejects authority injection', async () => {
    const offers = await slots();
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers)
      expect(Object.keys(offer)).toEqual(['token', 'startsAt', 'endsAt', 'timezone']);
    for (const extra of [
      { clinicId: f.otherClinicId },
      { providerId: f.providerId },
      { patientId: f.secondPatientId },
      { status: 'confirmed' },
      { completion_state: 'completed' },
    ])
      expect(
        (
          await mutation(
            f.app,
            f.origin,
            '/api/v1/appointments',
            { slotToken: offers[0]!.token, ...extra },
            user('patient').cookie,
          )
        ).status,
      ).toBe(400);
  });
  it('concurrent requests for the identical resource/time produce exactly one booking', async () => {
    const one = (await slots('patient', '2030-01-08'))[0]!;
    const two = (await slots('patient2', '2030-01-08')).find(
      (slot) => slot.startsAt === one.startsAt,
    )!;
    const result = await Promise.all([
      mutation(
        f.app,
        f.origin,
        '/api/v1/appointments',
        { slotToken: one.token },
        user('patient').cookie,
      ),
      mutation(
        f.app,
        f.origin,
        '/api/v1/appointments',
        { slotToken: two.token },
        user('patient2').cookie,
      ),
    ]);
    expect(result.map((row) => row.status).sort()).toEqual([200, 409]);
    const count = await f.database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM appointments WHERE clinic_id=$1 AND starts_at=$2',
      [f.clinicId, one.startsAt],
    );
    expect(count.rows[0]?.count).toBe('1');
  });
  it('book-confirm-reschedule-cancel retains one row and audits every transition', async () => {
    const booked = await book();
    const confirmed = AppointmentSchema.parse(
      (await action('receptionist', booked.id, booked.revision, 'confirm')).body,
    );
    expect(confirmed.status).toBe('confirmed');
    const newSlot = (await slots())[0]!;
    const response = await mutation(
      f.app,
      f.origin,
      `/api/v1/appointments/${booked.id}/reschedule`,
      { slotToken: newSlot.token, revision: confirmed.revision },
      user('patient').cookie,
    );
    expect(response.status).toBe(200);
    const moved = AppointmentSchema.parse(response.body);
    expect(moved.status).toBe('scheduled');
    const cancelled = await action('patient', booked.id, moved.revision, 'cancel');
    expect(cancelled.status).toBe(200);
    const history = AppointmentHistorySchema.parse(
      (
        await request(f.app)
          .get(`/api/v1/appointments/${booked.id}/history`)
          .set('cookie', user('patient').cookie)
          .expect(200)
      ).body,
    );
    expect(history.map((event) => event.action)).toEqual([
      'appointment.booked',
      'appointment.confirmed',
      'appointment.rescheduled',
      'appointment.cancelled',
    ]);
    const audit = await f.database.pool.query<{ actor_membership_id: string }>(
      'SELECT actor_membership_id FROM audit_events WHERE entity_id=$1 AND action=$2',
      [booked.id, 'appointment.confirmed'],
    );
    expect(audit.rows[0]?.actor_membership_id).toBe(user('receptionist').membershipId);
    expect(
      (await f.database.pool.query('SELECT 1 FROM appointments WHERE id=$1', [booked.id])).rowCount,
    ).toBe(1);
    await expect(
      f.database.pool.query('DELETE FROM appointments WHERE id=$1', [booked.id]),
    ).rejects.toMatchObject({ code: '55000' });
  });
  it.each(['clinic_owner', 'clinic_admin', 'dentist', 'receptionist', 'patient'])(
    'enforces %s role and clinic visibility',
    async (role) => {
      const booked = await book('patient', 0, '2030-01-09');
      await request(f.app)
        .get(`/api/v1/appointments/${booked.id}`)
        .set('cookie', user(role).cookie)
        .expect(200);
      for (const path of [
        `/api/v1/appointments/${booked.id}`,
        `/api/v1/appointments/${booked.id}/history`,
      ])
        await request(f.app).get(path).set('cookie', user('foreign').cookie).expect(404);
      await request(f.app)
        .get(
          `/api/v1/scheduling/availability?locationId=${f.locationId}&appointmentTypeId=${f.typeId}&date=${day}`,
        )
        .set('cookie', user('foreign').cookie)
        .expect(404);
      expect((await action('foreign', booked.id, 0, 'confirm')).status).toBe(404);
      expect(
        (
          await mutation(
            f.app,
            f.origin,
            `/api/v1/appointments/${booked.id}/reschedule`,
            { slotToken: (await slots(role))[0]!.token, revision: 0 },
            user('foreign').cookie,
          )
        ).status,
      ).toBe(404);
      const result = await action(role, booked.id, 0, 'confirm');
      expect(result.status).toBe(role === 'patient' ? 403 : 200);
      expect((await action('patient', booked.id, 0, 'complete')).status).toBe(
        role === 'patient' ? 403 : 409,
      );
    },
  );
  it('protects other patients and scopes the dentist calendar to assigned provider', async () => {
    const booked = await book('patient', 0, '2030-01-10');
    await request(f.app)
      .get(`/api/v1/appointments/${booked.id}`)
      .set('cookie', user('patient2').cookie)
      .expect(404);
    const otherProvider = randomUUID();
    const staffId = randomUUID();
    await f.database.pool.query(
      "INSERT INTO staff(id,clinic_id,membership_id,kind) VALUES($1,$2,$3,'provider')",
      [staffId, f.clinicId, user('clinic_admin').membershipId],
    );
    await f.database.pool.query(
      "INSERT INTO providers(id,clinic_id,staff_id,provider_type) VALUES($1,$2,$3,'dentist')",
      [otherProvider, f.clinicId, staffId],
    );
    await f.database.pool.query('UPDATE appointments SET provider_id=$1 WHERE id=$2', [
      otherProvider,
      booked.id,
    ]);
    await request(f.app)
      .get(`/api/v1/appointments/${booked.id}`)
      .set('cookie', user('dentist').cookie)
      .expect(404);
    const listed = AppointmentListSchema.parse(
      (await request(f.app).get('/api/v1/appointments').set('cookie', user('dentist').cookie)).body,
    );
    expect(listed.items.some((row) => row.id === booked.id)).toBe(false);
  });
  it('rejects foreign, expired, consumed, and tampered slot tokens', async () => {
    const offer = (await slots('patient2', '2030-01-11'))[0]!;
    expect(
      (
        await mutation(
          f.app,
          f.origin,
          '/api/v1/appointments',
          { slotToken: offer.token },
          user('patient').cookie,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await mutation(
          f.app,
          f.origin,
          '/api/v1/appointments',
          { slotToken: '0'.repeat(64) },
          user('patient2').cookie,
        )
      ).status,
    ).toBe(409);
    await f.database.pool.query(
      "UPDATE appointment_slot_offers SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
      [user('patient2').userId],
    );
    expect(
      (
        await mutation(
          f.app,
          f.origin,
          '/api/v1/appointments',
          { slotToken: offer.token },
          user('patient2').cookie,
        )
      ).status,
    ).toBe(409);
    const valid = (await slots('patient2', '2030-01-11'))[0]!;
    expect(
      (
        await mutation(
          f.app,
          f.origin,
          '/api/v1/appointments',
          { slotToken: valid.token },
          user('patient2').cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await mutation(
          f.app,
          f.origin,
          '/api/v1/appointments',
          { slotToken: valid.token },
          user('patient2').cookie,
        )
      ).status,
    ).toBe(409);
  });
  it('revalidates closures and does not commit a booking or consume the offer on failure', async () => {
    const offer = (await slots('patient', '2030-01-12'))[0]!;
    await f.database.pool.query(
      "INSERT INTO clinic_closures(clinic_id,location_id,starts_at,ends_at,reason) VALUES($1,$2,$3,$4,'Fictional closure')",
      [f.clinicId, f.locationId, offer.startsAt, offer.endsAt],
    );
    expect(
      (
        await mutation(
          f.app,
          f.origin,
          '/api/v1/appointments',
          { slotToken: offer.token },
          user('patient').cookie,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await f.database.pool.query(
          'SELECT 1 FROM appointments WHERE clinic_id=$1 AND starts_at=$2',
          [f.clinicId, offer.startsAt],
        )
      ).rowCount,
    ).toBe(0);
    const ledger = await f.database.pool.query<{ consumed_at: Date | null }>(
      'SELECT consumed_at FROM appointment_slot_offers WHERE starts_at=$1 AND user_id=$2',
      [offer.startsAt, user('patient').userId],
    );
    expect(ledger.rows[0]?.consumed_at).toBeNull();
  });
  it('enforces completion/no-show time rules and retains historical views', async () => {
    const booked = await book('patient', 0, '2030-01-13');
    expect((await action('dentist', booked.id, 0, 'no_show')).status).toBe(422);
    const confirmed = AppointmentSchema.parse(
      (await action('dentist', booked.id, 0, 'confirm')).body,
    );
    expect((await action('receptionist', booked.id, confirmed.revision, 'complete')).status).toBe(
      403,
    );
    expect((await action('dentist', booked.id, confirmed.revision, 'complete')).status).toBe(422);
    const past = randomUUID();
    await f.database.pool.query(
      "INSERT INTO appointments(id,clinic_id,location_id,provider_id,operatory_id,patient_id,appointment_type_id,status,starts_at,ends_at,timezone,created_by_membership_id) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now()-interval '2 hours',now()-interval '1 hour','Asia/Baghdad',$8)",
      [
        past,
        f.clinicId,
        f.locationId,
        f.providerId,
        f.operatoryId,
        f.patientId,
        f.typeId,
        user('receptionist').membershipId,
      ],
    );
    expect((await action('dentist', past, 0, 'complete')).status).toBe(200);
    expect((await action('dentist', past, 1, 'confirm')).status).toBe(422);
    const history = AppointmentListSchema.parse(
      (
        await request(f.app)
          .get('/api/v1/appointments?view=history')
          .set('cookie', user('patient').cookie)
      ).body,
    );
    expect(history.items.some((row) => row.id === past && row.status === 'completed')).toBe(true);
    const missing = randomUUID();
    await f.database.pool.query(
      "INSERT INTO appointments(id,clinic_id,location_id,provider_id,operatory_id,patient_id,appointment_type_id,starts_at,ends_at,timezone) VALUES($1,$2,$3,$4,$5,$6,$7,now()-interval '4 hours',now()-interval '3 hours','Asia/Baghdad')",
      [missing, f.clinicId, f.locationId, f.providerId, f.operatoryId, f.patientId, f.typeId],
    );
    expect((await action('receptionist', missing, 0, 'no_show')).status).toBe(200);
  });
  it('rejects stale transitions and a patient without an explicitly linked clinical entity', async () => {
    const booked = await book('patient', 0, '2030-01-14');
    expect((await action('receptionist', booked.id, 0, 'confirm')).status).toBe(200);
    expect((await action('receptionist', booked.id, 0, 'cancel')).status).toBe(409);
    const offer = (await slots('patient2', '2030-01-14'))[0]!;
    await f.database.pool.query('UPDATE patients SET portal_user_id=NULL WHERE id=$1', [
      f.secondPatientId,
    ]);
    expect(
      (
        await mutation(
          f.app,
          f.origin,
          '/api/v1/appointments',
          { slotToken: offer.token },
          user('patient2').cookie,
        )
      ).status,
    ).toBe(403);
    await f.database.pool.query('UPDATE patients SET portal_user_id=$1 WHERE id=$2', [
      user('patient2').userId,
      f.secondPatientId,
    ]);
  });
  it('administrators manage tenant configuration; patients and non-admin staff cannot', async () => {
    for (const role of ['patient', 'dentist', 'receptionist'])
      expect(
        (
          await mutation(
            f.app,
            f.origin,
            '/api/v1/scheduling/types',
            { name: 'Test', code: 'test', durationMinutes: 45 },
            user(role).cookie,
          )
        ).status,
      ).toBe(403);
    for (const role of ['clinic_owner', 'clinic_admin'])
      expect(
        (
          await mutation(
            f.app,
            f.origin,
            '/api/v1/scheduling/types',
            { name: 'Test', code: `test_${role}`, durationMinutes: 45 },
            user(role).cookie,
          )
        ).status,
      ).toBe(200);
    expect(
      (
        await mutation(
          f.app,
          f.origin,
          '/api/v1/scheduling/operatories',
          { locationId: f.otherLocationId, name: 'Illegal chair' },
          user('clinic_owner').cookie,
        )
      ).status,
    ).toBe(404);
    const hour = (
      await f.database.pool.query<{ id: string }>(
        'SELECT id FROM working_hours WHERE clinic_id=$1 LIMIT 1',
        [f.clinicId],
      )
    ).rows[0]!;
    expect(
      (
        await mutation(
          f.app,
          f.origin,
          `/api/v1/scheduling/hours/${hour.id}`,
          {},
          user('foreign').cookie,
          'delete',
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await mutation(
          f.app,
          f.origin,
          '/api/v1/appointments/staff',
          {
            slotToken: (await slots('receptionist', '2030-01-15'))[0]!.token,
            patientId: f.foreignPatientId,
          },
          user('receptionist').cookie,
        )
      ).status,
    ).toBe(404);
  });
  it('availability honors local date and bookings are excluded at half-open boundaries', async () => {
    const offers = await slots('patient', '2030-01-16');
    expect(offers[0]?.startsAt).toBe('2030-01-16T06:00:00Z');
    const first = await book('patient', 0, '2030-01-16');
    const remaining = await slots('patient2', '2030-01-16');
    expect(remaining.some((slot) => Date.parse(slot.startsAt) < Date.parse(first.endsAt))).toBe(
      false,
    );
    expect(remaining.some((slot) => Date.parse(slot.startsAt) === Date.parse(first.endsAt))).toBe(
      true,
    );
    const result = AppointmentListSchema.parse(
      (
        await request(f.app)
          .get('/api/v1/appointments?date=2030-01-16')
          .set('cookie', user('patient').cookie)
      ).body,
    );
    expect(result.items.map((row) => row.id)).toContain(first.id);
    expect(calendarDateDistance(clinicToday('Asia/Baghdad'), day)).toBeGreaterThan(0);
  });
  it('PostgreSQL itself rejects concurrent direct writes, without API locks or availability checks', async () => {
    const statement =
      "INSERT INTO appointments(clinic_id,patient_id,location_id,provider_id,operatory_id,appointment_type_id,starts_at,ends_at,timezone) VALUES($1,$2,$3,$4,$5,$6,'2030-02-01T06:00Z','2030-02-01T06:30Z','Asia/Baghdad')";
    const values = [f.clinicId, f.patientId, f.locationId, f.providerId, f.operatoryId, f.typeId];
    const result = await Promise.allSettled([
      f.database.pool.query(statement, values),
      f.database.pool.query(statement, [f.clinicId, f.secondPatientId, ...values.slice(2)]),
    ]);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = result.find((item) => item.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ code: '23P01' });
    expect(
      (
        await f.database.pool.query(
          "SELECT 1 FROM appointments WHERE clinic_id=$1 AND starts_at='2030-02-01T06:00Z'",
          [f.clinicId],
        )
      ).rowCount,
    ).toBe(1);
  });
  it('serializes direct closure/appointment races in either direction', async () => {
    const result = await Promise.allSettled([
      f.database.pool.query(
        "INSERT INTO clinic_closures(clinic_id,location_id,starts_at,ends_at,reason) VALUES($1,$2,'2030-02-02T06:00Z','2030-02-02T06:30Z','Fictional maintenance')",
        [f.clinicId, f.locationId],
      ),
      f.database.pool.query(
        "INSERT INTO appointments(clinic_id,patient_id,location_id,provider_id,operatory_id,appointment_type_id,starts_at,ends_at,timezone) VALUES($1,$2,$3,$4,$5,$6,'2030-02-02T06:00Z','2030-02-02T06:30Z','Asia/Baghdad')",
        [f.clinicId, f.patientId, f.locationId, f.providerId, f.operatoryId, f.typeId],
      ),
    ]);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = result.find((item) => item.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ code: '23P01' });
  });
  it('enforces database transitions, tenant foreign keys and immutable historical timezones', async () => {
    const booked = await book('patient', 0, '2030-02-03');
    await expect(
      f.database.pool.query("UPDATE appointments SET status='completed' WHERE id=$1", [booked.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      f.database.pool.query('UPDATE appointments SET location_id=$1 WHERE id=$2', [
        f.otherLocationId,
        booked.id,
      ]),
    ).rejects.toMatchObject({ code: '23503' });
    expect((await action('patient', booked.id, 0, 'cancel')).status).toBe(200);
    await expect(
      f.database.pool.query("UPDATE appointments SET timezone='Etc/UTC' WHERE id=$1", [booked.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('patients cannot mutate someone else’s appointment or use staff booking', async () => {
    const booked = await book('patient', 0, '2030-02-04');
    const offer = (await slots('patient2', '2030-02-04'))[0]!;
    expect((await action('patient2', booked.id, 0, 'cancel')).status).toBe(404);
    expect(
      (
        await mutation(
          f.app,
          f.origin,
          `/api/v1/appointments/${booked.id}/reschedule`,
          { slotToken: offer.token, revision: 0 },
          user('patient2').cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await mutation(
          f.app,
          f.origin,
          '/api/v1/appointments/staff',
          { slotToken: offer.token, patientId: f.patientId },
          user('patient2').cookie,
        )
      ).status,
    ).toBe(403);
    await request(f.app)
      .get(`/api/v1/appointments/${booked.id}/history`)
      .set('cookie', user('patient2').cookie)
      .expect(404);
  });
  it('invalid tenant type IDs fail closed, and hours changes invalidate previously issued offers', async () => {
    await request(f.app)
      .get(
        `/api/v1/scheduling/availability?locationId=${f.locationId}&appointmentTypeId=${f.otherTypeId}&date=${day}`,
      )
      .set('cookie', user('patient').cookie)
      .expect(404);
    const date = '2030-02-05';
    const offer = (await slots('patient', date))[0]!;
    const hours = await f.database.pool.query<{ id: string }>(
      "INSERT INTO working_hours(clinic_id,location_id,provider_id,weekday,opens_at_local,closes_at_local) VALUES($1,$2,$3,2,'12:00','13:00') RETURNING id",
      [f.clinicId, f.locationId, f.providerId],
    );
    try {
      expect(
        (
          await mutation(
            f.app,
            f.origin,
            '/api/v1/appointments',
            { slotToken: offer.token },
            user('patient').cookie,
          )
        ).status,
      ).toBe(409);
      const available = await slots('patient', date);
      expect(
        available.every(
          (slot) =>
            slot.startsAt >= '2030-02-05T09:00:00Z' && slot.endsAt <= '2030-02-05T10:00:00Z',
        ),
      ).toBe(true);
      expect(available.length).toBeGreaterThan(0);
    } finally {
      await f.database.pool.query('DELETE FROM working_hours WHERE id=$1', [hours.rows[0]!.id]);
    }
  });
  it('schedule blocks exclude slots and also reject stale offers at the database layer', async () => {
    const offer = (await slots('patient', '2030-02-06'))[0]!;
    await f.database.pool.query(
      "INSERT INTO schedule_blocks(clinic_id,location_id,provider_id,starts_at,ends_at,timezone,reason) VALUES($1,$2,$3,$4,$5,'Asia/Baghdad','Fictional provider break')",
      [f.clinicId, f.locationId, f.providerId, offer.startsAt, offer.endsAt],
    );
    expect(
      (
        await mutation(
          f.app,
          f.origin,
          '/api/v1/appointments',
          { slotToken: offer.token },
          user('patient').cookie,
        )
      ).status,
    ).toBe(409);
    expect(
      (await slots('patient', '2030-02-06')).some((slot) => slot.startsAt === offer.startsAt),
    ).toBe(false);
  });
});
