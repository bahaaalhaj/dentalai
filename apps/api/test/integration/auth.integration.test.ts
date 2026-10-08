import { randomUUID } from 'node:crypto';
import { createDatabase, migrateDatabase } from '@dentalai/database';
import { AuthIdentitySchema, SessionListSchema, type ClinicRole } from '@dentalai/contracts';
import { Pool } from 'pg';
import pino from 'pino';
import request, { type Response } from 'supertest';
import type { Express } from 'express';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApplication } from '../../src/app.js';
import { createAuthProvider } from '../../src/domains/auth/auth.provider.js';
import type { AuthMail } from '../../src/domains/auth/mail.js';
import { AccessRepository } from '../../src/domains/access/access.repository.js';
import { PostgresSystemRepository } from '../../src/domains/system/system.repository.js';
import { SystemService } from '../../src/domains/system/system.service.js';
import { ApplicationLifecycle } from '../../src/infrastructure/lifecycle.js';

const adminUrl = process.env['DATABASE_URL'];
if (!adminUrl) throw new Error('DATABASE_URL must point to a disposable PostgreSQL instance.');
const databaseName = `dentalai_auth_test_${randomUUID().replaceAll('-', '')}`;
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const admin = new Pool({ connectionString: adminUrl });
const database = createDatabase(url.toString());
const origin = 'https://dentalai.test';
const password = 'Fictional-test-password-2026!';
const mail: AuthMail[] = [];
const clinicA = randomUUID();
const clinicB = randomUUID();
let app: Express;
const people = new Map<
  ClinicRole,
  { cookie: string; userId: string; membershipId: string; email: string }
>();
let foreign: { cookie: string; userId: string; membershipId: string; email: string };
let ownPatient: string;
let otherPatient: string;
let foreignPatient: string;
const options = {
  secret: randomUUID() + randomUUID(),
  origin,
  sendMail: async (message: AuthMail) => {
    mail.push(message);
  },
};

function cookies(response: Response): string[] {
  const raw: unknown = response.headers['set-cookie'];
  return (Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : []).map(
    (value) => value.split(';')[0] ?? '',
  );
}
async function mutate(
  path: string,
  body: unknown = {},
  cookie = '',
  method: 'post' | 'delete' = 'post',
) {
  const csrf = await request(app).get('/api/v1/access/csrf').expect(200);
  return request(app)
    [method](path)
    .set('origin', origin)
    .set('cookie', [cookie, ...cookies(csrf)].filter(Boolean).join('; '))
    .set('x-csrf-token', String(csrf.body.token))
    .send(body);
}
async function clearRateLimits() {
  await database.pool.query('DELETE FROM auth_rate_limits');
}
async function register(email: string, verify = true) {
  await clearRateLimits();
  const response = await mutate('/api/v1/auth/sign-up/email', {
    name: 'Fictional account',
    email,
    password,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.body).toEqual({ success: true });
  expect(cookies(response).some((cookie) => cookie.includes('session_token'))).toBe(false);
  if (verify) {
    const message = mail.findLast(
      (value) => value.to === email && value.subject.includes('Verify'),
    );
    expect(message).toBeDefined();
    const link = new URL(message?.text.split(' ').at(-1) ?? '');
    await request(app)
      .get(
        `/api/v1/auth/verify-email?token=${encodeURIComponent(link.searchParams.get('token') ?? '')}`,
      )
      .expect(302);
  }
}
async function login(email: string, prior = '', value = password) {
  const response = await mutate('/api/v1/auth/sign-in/email', { email, password: value }, prior);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const cookie = cookies(response).find((value) => value.includes('session_token='));
  expect(cookie).toBeDefined();
  expect(response.headers['set-cookie']).toEqual(
    expect.arrayContaining([expect.stringMatching(/Secure.*HttpOnly|HttpOnly.*Secure/)]),
  );
  expect(JSON.stringify(response.body)).not.toContain('token');
  return cookie ?? '';
}
async function fixture(role: ClinicRole, clinicId: string) {
  const email = `${role}-${randomUUID()}@example.test`;
  await register(email);
  const cookie = await login(email);
  const identity = AuthIdentitySchema.parse(
    (await request(app).get('/api/v1/access/me').set('cookie', cookie).expect(200)).body,
  );
  const membershipId = randomUUID();
  await database.pool.query(
    "INSERT INTO memberships(id,clinic_id,user_id,status,joined_at) VALUES($1,$2,$3,'active',now())",
    [membershipId, clinicId, identity.user.id],
  );
  await database.pool.query(
    'INSERT INTO membership_roles(clinic_id,membership_id,role_id) SELECT $1,$2,id FROM roles WHERE clinic_id=$1 AND key=$3',
    [clinicId, membershipId, role],
  );
  return { cookie, userId: identity.user.id, membershipId, email };
}
beforeAll(async () => {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  await migrateDatabase(url.toString());
  for (const clinicId of [clinicA, clinicB]) {
    await database.pool.query(
      "INSERT INTO clinics(id,legal_name,display_name,slug,default_timezone,default_currency) VALUES($1,'Fictional clinic','Fictional clinic',$2,'Etc/UTC','USD')",
      [clinicId, `test-${clinicId}`],
    );
    for (const role of ['clinic_owner', 'clinic_admin', 'dentist', 'receptionist', 'patient'])
      await database.pool.query('INSERT INTO roles(clinic_id,key,name) VALUES($1,$2,$2)', [
        clinicId,
        role,
      ]);
  }
  const provider = createAuthProvider(database.db, options);
  app = await createApplication({
    logger: pino({ level: 'silent' }),
    systemService: new SystemService(
      new PostgresSystemRepository(database.pool),
      new ApplicationLifecycle(),
    ),
    options: {
      bodyLimit: '100kb',
      corsOrigins: [],
      trustProxy: false,
      rateLimitMax: 5000,
      rateLimitWindowMs: 60000,
    },
    authentication: {
      provider,
      options,
      repository: new AccessRepository(database.pool, database.db),
    },
  });
  for (const role of [
    'clinic_owner',
    'clinic_admin',
    'dentist',
    'receptionist',
    'patient',
  ] as const)
    people.set(role, await fixture(role, clinicA));
  foreign = await fixture('clinic_owner', clinicB);
  ownPatient = randomUUID();
  otherPatient = randomUUID();
  foreignPatient = randomUUID();
  for (const [id, clinicId, portal] of [
    [ownPatient, clinicA, people.get('patient')?.userId],
    [otherPatient, clinicA, null],
    [foreignPatient, clinicB, foreign.userId],
  ]) {
    await database.pool.query(
      "INSERT INTO patients(id,clinic_id,portal_user_id,medical_record_number,given_name,family_name) VALUES($1,$2,$3,$4,'Fictional','Patient')",
      [id, clinicId, portal, id],
    );
  }
});
beforeEach(clearRateLimits);
afterAll(async () => {
  await database.pool.end();
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
    [databaseName],
  );
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin.end();
});

describe('backend authentication and tenancy', () => {
  it.each(['clinic_owner', 'clinic_admin', 'dentist', 'receptionist', 'patient'] as const)(
    'authorizes %s using live membership and prevents cross-clinic resources',
    async (role) => {
      const person = people.get(role)!;
      const identity = AuthIdentitySchema.parse(
        (await request(app).get('/api/v1/access/me').set('cookie', person.cookie).expect(200)).body,
      );
      expect(identity.activeMembership?.roles).toContain(role);
      await request(app).get('/api/v1/access/clinic').set('cookie', person.cookie).expect(200);
      SessionListSchema.parse(
        (await request(app).get('/api/v1/access/sessions').set('cookie', person.cookie).expect(200))
          .body,
      );
      await request(app)
        .get(`/api/v1/access/patients/${ownPatient}`)
        .set('cookie', person.cookie)
        .expect(200);
      await request(app)
        .get(`/api/v1/access/patients/${foreignPatient}`)
        .set('cookie', person.cookie)
        .expect(404);
      expect(
        (
          await mutate(
            '/api/v1/access/select-membership',
            { membershipId: foreign.membershipId },
            person.cookie,
          )
        ).status,
      ).toBe(403);
      const foreignSessions = SessionListSchema.parse(
        (await request(app).get('/api/v1/access/sessions').set('cookie', foreign.cookie)).body,
      );
      expect(
        (
          await mutate(
            `/api/v1/access/sessions/${foreignSessions[0]?.id}`,
            {},
            person.cookie,
            'delete',
          )
        ).status,
      ).toBe(404);
      const isAdmin = role === 'clinic_admin' || role === 'clinic_owner';
      await request(app)
        .get('/api/v1/access/invitations')
        .set('cookie', person.cookie)
        .expect(isAdmin ? 200 : 403);
    },
  );
  it('does not let a patient access another patient in the same clinic', async () => {
    await request(app)
      .get(`/api/v1/access/patients/${otherPatient}`)
      .set('cookie', people.get('patient')!.cookie)
      .expect(404);
  });
  it.each(['doctor', 'dentist', 'clinic_owner', 'clinic_admin'])(
    'rejects public role injection: %s',
    async (role) => {
      const email = `${randomUUID()}@example.test`;
      expect(
        (await mutate('/api/v1/auth/sign-up/email', { name: 'Fake', email, password, role }))
          .status,
      ).toBe(400);
      expect(
        (await database.pool.query('SELECT 1 FROM users WHERE email=$1', [email])).rowCount,
      ).toBe(0);
    },
  );
  it('registers no membership and rejects identity/tenant injection and CSRF', async () => {
    const email = `${randomUUID()}@example.test`;
    await register(email);
    const cookie = await login(email);
    const identity = AuthIdentitySchema.parse(
      (await request(app).get('/api/v1/access/me').set('cookie', cookie)).body,
    );
    expect(identity.accountRole).toBe('patient');
    expect(identity.memberships).toEqual([]);
    await request(app).get('/api/v1/access/clinic').set('cookie', cookie).expect(403);
    for (const extra of [
      { clinicId: clinicA },
      { userId: foreign.userId },
      { membership: foreign.membershipId },
    ])
      expect(
        (await mutate('/api/v1/auth/sign-up/email', { name: 'Fake', email, password, ...extra }))
          .status,
      ).toBe(400);
    await request(app).post('/api/v1/auth/sign-in/email').send({ email, password }).expect(403);
    const csrf = await request(app).get('/api/v1/access/csrf');
    await request(app)
      .post('/api/v1/auth/sign-in/email')
      .set('origin', 'https://evil.test')
      .set('cookie', cookies(csrf).join('; '))
      .set('x-csrf-token', String(csrf.body.token))
      .send({ email, password })
      .expect(403);
  });
  it('requires email verification and allows resending verification', async () => {
    const email = `${randomUUID()}@example.test`;
    await register(email, false);
    expect((await mutate('/api/v1/auth/sign-in/email', { email, password })).status).toBe(403);
    const count = mail.length;
    expect((await mutate('/api/v1/auth/send-verification-email', { email })).status).toBe(200);
    expect(mail.length).toBeGreaterThan(count);
  });
  it.each(['clinic_owner', 'clinic_admin'] as const)(
    '%s invites staff; invitation is email-bound, single-use and clinic-scoped',
    async (role) => {
      const email = `${randomUUID()}@example.test`;
      await register(email);
      const invited = await login(email);
      const person = people.get(role)!;
      const response = await mutate(
        '/api/v1/access/invitations',
        { email, role: 'dentist' },
        person.cookie,
      );
      expect(response.status).toBe(200);
      const invitationId = String(response.body.id);
      const token = new URL(
        mail
          .findLast((value) => value.to === email && value.subject.includes('invitation'))
          ?.text.split(' ')
          .at(-1) ?? '',
      ).hash.slice(7);
      expect(
        (await mutate(`/api/v1/access/invitations/${invitationId}`, {}, foreign.cookie, 'delete'))
          .status,
      ).toBe(404);
      const listed = await request(app)
        .get('/api/v1/access/invitations')
        .set('cookie', foreign.cookie)
        .expect(200);
      expect(JSON.stringify(listed.body)).not.toContain(invitationId);
      expect(
        (await mutate('/api/v1/access/invitations/accept', { token }, foreign.cookie)).status,
      ).toBe(403);
      expect((await mutate('/api/v1/access/invitations/accept', { token }, invited)).status).toBe(
        200,
      );
      const identity = AuthIdentitySchema.parse(
        (await request(app).get('/api/v1/access/me').set('cookie', invited)).body,
      );
      expect(identity.activeMembership?.roles).toContain('dentist');
      expect(identity.activeMembership?.clinicId).toBe(clinicA);
      expect((await mutate('/api/v1/access/invitations/accept', { token }, invited)).status).toBe(
        403,
      );
      expect(
        (
          await mutate(
            '/api/v1/access/invitations',
            { email: `x-${email}`, role: 'clinic_owner' },
            person.cookie,
          )
        ).status,
      ).toBe(400);
    },
  );
  it.each(['dentist', 'receptionist', 'patient'] as const)(
    '%s cannot create staff invitations',
    async (role) => {
      expect(
        (
          await mutate(
            '/api/v1/access/invitations',
            { email: 'staff@example.test', role: 'dentist' },
            people.get(role)!.cookie,
          )
        ).status,
      ).toBe(403);
    },
  );
  it('rotates incoming sessions, revokes old cookies, and logs out server-side', async () => {
    const email = `${randomUUID()}@example.test`;
    await register(email);
    const old = await login(email);
    const fresh = await login(email, old);
    expect(fresh).not.toBe(old);
    await request(app).get('/api/v1/access/me').set('cookie', old).expect(401);
    expect((await mutate('/api/v1/auth/sign-out', {}, fresh)).status).toBe(200);
    await request(app).get('/api/v1/access/me').set('cookie', fresh).expect(401);
  });
  it('revokes a listed session, rejects revoked and expired sessions', async () => {
    const email = `${randomUUID()}@example.test`;
    await register(email);
    const cookie = await login(email);
    const list = SessionListSchema.parse(
      (await request(app).get('/api/v1/access/sessions').set('cookie', cookie)).body,
    );
    expect(
      (await mutate(`/api/v1/access/sessions/${list[0]?.id}`, {}, cookie, 'delete')).status,
    ).toBe(200);
    await request(app).get('/api/v1/access/me').set('cookie', cookie).expect(401);
    const expired = await login(email);
    await database.pool.query(
      "UPDATE auth_sessions SET expires_at=now()-interval '1 minute' WHERE user_id=(SELECT id FROM users WHERE email=$1)",
      [email],
    );
    await request(app).get('/api/v1/access/me').set('cookie', expired).expect(401);
  });
  it('resets once, revokes every old session, and invalidates the old password', async () => {
    const email = `${randomUUID()}@example.test`;
    await register(email);
    const cookie = await login(email);
    const second = await login(email);
    expect((await mutate('/api/v1/auth/request-password-reset', { email })).status).toBe(200);
    const token = new URL(
      mail
        .findLast((value) => value.to === email && value.subject.includes('Reset'))
        ?.text.split(' ')
        .at(-1) ?? '',
    ).hash.slice(7);
    const newPassword = `${password}-new`;
    expect((await mutate('/api/v1/auth/reset-password', { token, newPassword })).status).toBe(200);
    for (const value of [cookie, second])
      await request(app).get('/api/v1/access/me').set('cookie', value).expect(401);
    expect((await mutate('/api/v1/auth/reset-password', { token, newPassword })).status).toBe(400);
    expect((await mutate('/api/v1/auth/sign-in/email', { email, password })).status).toBe(401);
    await login(email, '', newPassword);
    const hashes = await database.pool.query<{ password: string }>(
      'SELECT a.password FROM auth_accounts a JOIN users u ON u.id=a.user_id WHERE u.email=$1',
      [email],
    );
    expect(hashes.rows[0]?.password).not.toContain(password);
  });
  it('blocks brute force using persistent account-keyed counters', async () => {
    const email = `${randomUUID()}@example.test`;
    await register(email);
    for (let i = 0; i < 5; i++)
      expect(
        (await mutate('/api/v1/auth/sign-in/email', { email, password: 'wrong-password' })).status,
      ).toBe(401);
    expect((await mutate('/api/v1/auth/sign-in/email', { email, password })).status).toBe(429);
  });
  it('rate-limits sign-in even when browser-supplied forwarding headers change', async () => {
    for (let i = 0; i < 10; i++) {
      const csrf = await request(app).get('/api/v1/access/csrf');
      const response = await request(app)
        .post('/api/v1/auth/sign-in/email')
        .set('origin', origin)
        .set('cookie', cookies(csrf).join('; '))
        .set('x-csrf-token', String(csrf.body.token))
        .set('x-dentalai-client-ip', `192.0.2.${i}`)
        .set('x-forwarded-for', `192.0.2.${i}`)
        .send({ email: `missing-${i}@example.test`, password });
      expect(response.status).toBe(401);
    }
    expect(
      (
        await mutate('/api/v1/auth/sign-in/email', {
          email: 'another-missing@example.test',
          password,
        })
      ).status,
    ).toBe(429);
  });
  it('rejects database session contexts belonging to a different user', async () => {
    await expect(
      database.pool.query(
        'UPDATE auth_sessions SET clinic_id=$1,active_membership_id=$2 WHERE user_id=$3',
        [clinicB, foreign.membershipId, people.get('patient')!.userId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
  it('rechecks membership revocation and writes token-free append-only security audit', async () => {
    const person = await fixture('receptionist', clinicA);
    await database.pool.query("UPDATE memberships SET status='revoked' WHERE id=$1", [
      person.membershipId,
    ]);
    await request(app).get('/api/v1/access/clinic').set('cookie', person.cookie).expect(403);
    const events = await database.pool.query('SELECT action,data FROM security_events');
    expect(events.rows.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(events.rows);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain('session_token');
    await expect(
      database.pool.query("UPDATE security_events SET action='tampered'"),
    ).rejects.toThrow();
  });
});
