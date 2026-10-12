import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { assertRestrictedDatabaseIdentity } from '../../src/infrastructure/database-identity.js';
import {
  createSchedulingFixture,
  fixturePassword,
  mutation,
  responseCookies,
} from '../support/scheduling-fixture.js';
import { AvailabilitySchema } from '@dentalai/contracts';
import { FilesystemPrivateStorage } from '../../src/domains/imaging/filesystem-storage.js';

let f: Awaited<ReturnType<typeof createSchedulingFixture>>;
let directory: string;
beforeAll(async () => {
  if (!process.env['DATABASE_URL']) throw new Error('Disposable DATABASE_URL required');
  directory = await mkdtemp(path.join(os.tmpdir(), 'dentalai-hardening-'));
  f = await createSchedulingFixture(process.env['DATABASE_URL'], undefined, undefined, {
    storage: new FilesystemPrivateStorage(directory),
  });
  await f.database.pool.query(
    'INSERT INTO clinic_settings(clinic_id,appointment_horizon_days) VALUES($1,3650)',
    [f.clinicId],
  );
});
afterAll(async () => {
  if (f) await f.dispose();
  if (directory) await rm(directory, { recursive: true, force: true });
});
const availability = () =>
  `/api/v1/scheduling/availability?locationId=${f.locationId}&appointmentTypeId=${f.typeId}&date=2030-03-04`;
describe('Phase 14 adversarial tenant and bounded load smoke', () => {
  it('rejects privileged DB identity and permits a non-owner role without mutable audit access', async () => {
    await expect(assertRestrictedDatabaseIdentity(f.database.pool)).rejects.toThrow('restricted');
    const role = `dentalai_gate_${randomUUID().replaceAll('-', '')}`;
    await f.database.pool.query(
      `CREATE ROLE ${role} LOGIN PASSWORD 'Disposable-role-fixture-only'`,
    );
    const url = new URL(process.env['DATABASE_URL']!);
    url.pathname = new URL(f.database.pool.options.connectionString!).pathname;
    url.username = role;
    url.password = 'Disposable-role-fixture-only';
    const restricted = new Pool({ connectionString: url.toString() });
    try {
      await f.database.pool.query(
        `GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,INSERT ON audit_events TO ${role}`,
      );
      await expect(assertRestrictedDatabaseIdentity(restricted)).resolves.toBeUndefined();
      await expect(restricted.query('UPDATE audit_events SET action=action')).rejects.toMatchObject(
        { code: '42501' },
      );
      await expect(restricted.query('TRUNCATE audit_events')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(
        restricted.query('CREATE TABLE public.unsafe_gate(id integer)'),
      ).rejects.toMatchObject({ code: '42501' });
      await f.database.pool.query(`GRANT UPDATE ON audit_events TO ${role}`);
      await expect(assertRestrictedDatabaseIdentity(restricted)).rejects.toThrow('restricted');
    } finally {
      await restricted.end();
      await f.database.pool.query(
        `REVOKE ALL ON audit_events FROM ${role}; REVOKE ALL ON SCHEMA public FROM ${role}; DROP ROLE ${role}`,
      );
    }
  });
  it('rejects IDOR across clinical, imaging and availability boundaries', async () => {
    for (const endpoint of [
      `/api/v1/clinical/patients/${f.foreignPatientId}`,
      `/api/v1/imaging/patients/${f.foreignPatientId}`,
    ]) {
      const response = await request(f.app)
        .get(endpoint)
        .set('cookie', f.members['dentist']!.cookie);
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain(f.foreignPatientId);
    }
    await request(f.app)
      .get(
        `/api/v1/scheduling/availability?locationId=${f.otherLocationId}&appointmentTypeId=${f.otherTypeId}&date=2030-03-04`,
      )
      .set('cookie', f.members['patient']!.cookie)
      .expect(404);
    const forged = await mutation(
      f.app,
      f.origin,
      '/api/v1/appointments',
      {
        slotToken: 'invalid',
        clinicId: f.otherClinicId,
        providerId: f.providerId,
        status: 'completed',
      },
      f.members['patient']!.cookie,
    );
    expect([400, 422]).toContain(forged.status);
    const csrf = await request(f.app)
      .post('/api/v1/appointments')
      .set('cookie', f.members['patient']!.cookie)
      .set('origin', 'https://attacker.example.test')
      .send({});
    expect(csrf.status).toBe(403);
  });
  it('runs real password verification, 5-way concurrent reads, competing booking and private uploads', async () => {
    await f.database.pool.query('DELETE FROM auth_rate_limits');
    const durations: Record<string, number[]> = {};
    async function timed(
      group: string,
      operation: () => PromiseLike<{ status: number }>,
      allowed = [200],
    ) {
      const start = performance.now();
      const result = await operation();
      (durations[group] ??= []).push(performance.now() - start);
      expect(allowed).toContain(result.status);
      return result;
    }
    const csrf = await request(f.app).get('/api/v1/access/csrf').expect(200);
    await Promise.all(
      Array.from({ length: 4 }, () =>
        timed('login', () =>
          request(f.app)
            .post('/api/v1/auth/sign-in/email')
            .set('origin', f.origin)
            .set('cookie', responseCookies(csrf).join('; '))
            .set('x-csrf-token', String(csrf.body.token))
            .send({ email: f.members['patient']!.email, password: fixturePassword }),
        ),
      ),
    );
    for (let wave = 0; wave < 5; wave++) {
      await Promise.all(
        Array.from({ length: 5 }, () =>
          timed('availability', () =>
            request(f.app).get(availability()).set('cookie', f.members['patient']!.cookie),
          ),
        ),
      );
      await Promise.all(
        Array.from({ length: 5 }, () =>
          timed('records', () =>
            request(f.app)
              .get('/api/v1/clinical/portal')
              .set('cookie', f.members['patient']!.cookie),
          ),
        ),
      );
    }
    const slots = AvailabilitySchema.parse(
      (
        await request(f.app)
          .get(availability())
          .set('cookie', f.members['patient']!.cookie)
          .expect(200)
      ).body,
    ).slots;
    expect(slots.length).toBeGreaterThan(0);
    const booking = await Promise.all(
      ['patient', 'patient2'].map((role) =>
        timed(
          'booking',
          () =>
            mutation(
              f.app,
              f.origin,
              '/api/v1/appointments',
              { slotToken: slots[0]!.token },
              f.members[role]!.cookie,
            ),
          [200, 409],
        ),
      ),
    );
    expect(booking.filter((response) => response.status === 200)).toHaveLength(1);
    const image = await sharp({
      create: { width: 64, height: 64, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    for (let index = 0; index < 3; index++)
      await timed(
        'upload',
        () =>
          request(f.app)
            .post(`/api/v1/imaging/patients/${f.patientId}/images`)
            .set('origin', f.origin)
            .set('cookie', [f.members['dentist']!.cookie, ...responseCookies(csrf)].join('; '))
            .set('x-csrf-token', String(csrf.body.token))
            .set('content-type', 'image/png')
            .set('x-imaging-reason', 'Synthetic load fixture, no patient image')
            .send(image),
        [201],
      );
    const report = Object.fromEntries(
      Object.entries(durations).map(([group, values]) => {
        values.sort((a, b) => a - b);
        return [
          group,
          {
            requests: values.length,
            p95Ms: Math.round(values[Math.ceil(values.length * 0.95) - 1]!),
          },
        ];
      }),
    );
    // A bounded regression smoke, not a clinic-scale capacity or clinical validation claim.
    for (const metric of Object.values(report)) expect(metric.p95Ms).toBeLessThan(10000);
    console.log('Phase14 synthetic load smoke:', JSON.stringify(report));
  });
});
