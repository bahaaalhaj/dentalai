import { randomUUID } from 'node:crypto';
import { createDatabase, migrateDatabase } from '@dentalai/database';
import type { ClinicRole } from '@dentalai/contracts';
import { Pool } from 'pg';
import pino from 'pino';
import request, { type Response } from 'supertest';
import type { Express } from 'express';
import { createApplication } from '../../src/app.js';
import type { ApiApplicationDependencies } from '../../src/app.js';
import { createAuthProvider } from '../../src/domains/auth/auth.provider.js';
import { AccessRepository } from '../../src/domains/access/access.repository.js';
import { PostgresSystemRepository } from '../../src/domains/system/system.repository.js';
import { SystemService } from '../../src/domains/system/system.service.js';
import { ApplicationLifecycle } from '../../src/infrastructure/lifecycle.js';

export const fixturePassword = 'Fictional-scheduling-password-2026!';
export function responseCookies(response: Response): string[] {
  const raw: unknown = response.headers['set-cookie'];
  return (Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : []).map(
    (value) => value.split(';')[0] ?? '',
  );
}
export async function mutation(
  app: Express,
  origin: string,
  path: string,
  body: object,
  cookie: string,
  method: 'post' | 'put' | 'delete' = 'post',
) {
  const csrf = await request(app).get('/api/v1/access/csrf').expect(200);
  return request(app)
    [method](path)
    .set('origin', origin)
    .set('cookie', [cookie, ...responseCookies(csrf)].join('; '))
    .set('x-csrf-token', String(csrf.body.token))
    .send(body);
}
export async function createSchedulingFixture(
  adminUrl: string,
  origin = 'https://scheduling.example.test',
  mountFrontend?: (app: Express) => void,
  imaging?: ApiApplicationDependencies['imaging'],
) {
  const databaseName = `dentalai_scheduling_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: adminUrl });
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  await migrateDatabase(url.toString());
  const database = createDatabase(url.toString());
  const clinicId = randomUUID();
  const otherClinicId = randomUUID();
  const locationId = randomUUID();
  const otherLocationId = randomUUID();
  const typeId = randomUUID();
  const otherTypeId = randomUUID();
  const operatoryId = randomUUID();
  for (const [id, slug] of [
    [clinicId, 'fixture-a'],
    [otherClinicId, 'fixture-b'],
  ]) {
    await database.pool.query(
      "INSERT INTO clinics(id,slug,legal_name,display_name,default_timezone,default_currency) VALUES($1,$2,'Fictional clinic','Fictional clinic','Asia/Baghdad','USD')",
      [id, slug],
    );
    for (const role of ['clinic_owner', 'clinic_admin', 'dentist', 'receptionist', 'patient'])
      await database.pool.query('INSERT INTO roles(clinic_id,key,name) VALUES($1,$2,$2)', [
        id,
        role,
      ]);
  }
  for (const [id, clinic] of [
    [locationId, clinicId],
    [otherLocationId, otherClinicId],
  ])
    await database.pool.query(
      "INSERT INTO locations(id,clinic_id,name,timezone) VALUES($1,$2,'Fictional office','Asia/Baghdad')",
      [id, clinic],
    );
  await database.pool.query(
    "INSERT INTO operatories(id,clinic_id,location_id,name) VALUES($1,$2,$3,'Chair one')",
    [operatoryId, clinicId, locationId],
  );
  for (const [id, clinic] of [
    [typeId, clinicId],
    [otherTypeId, otherClinicId],
  ])
    await database.pool.query(
      "INSERT INTO appointment_types(id,clinic_id,name,code,default_duration_minutes) VALUES($1,$2,'Consultation','consultation',30)",
      [id, clinic],
    );
  for (let day = 0; day < 7; day++)
    await database.pool.query(
      "INSERT INTO working_hours(clinic_id,location_id,weekday,opens_at_local,closes_at_local) VALUES($1,$2,$3,'09:00','17:00')",
      [clinicId, locationId, day],
    );
  const authOptions = {
    secret: randomUUID() + randomUUID(),
    origin,
    sendMail: async () => undefined,
  };
  const provider = createAuthProvider(database.db, authOptions);
  const accessRepository = new AccessRepository(database.pool, database.db);
  const app = await createApplication({
    logger: pino({ level: 'silent' }),
    systemService: new SystemService(
      new PostgresSystemRepository(database.pool),
      new ApplicationLifecycle(),
    ),
    options: {
      bodyLimit: '100kb',
      corsOrigins: [],
      trustProxy: false,
      rateLimitMax: 10000,
      rateLimitWindowMs: 60000,
    },
    authentication: {
      provider,
      repository: accessRepository,
      options: authOptions,
    },
    ...(mountFrontend ? { mountFrontend } : {}),
    ...(imaging ? { imaging } : {}),
  });
  // Auth and CSRF signing secrets need not be identical for this injected fixture; neither leaves the server.
  const members: Record<
    string,
    { userId: string; membershipId: string; cookie: string; email: string; clinicId: string }
  > = {};
  let providerId = '';
  let patientId = '';
  let secondPatientId = '';
  let foreignPatientId = '';
  for (const [label, role, clinic] of [
    ...(['clinic_owner', 'clinic_admin', 'dentist', 'receptionist', 'patient'] as const).map(
      (role) => [role, role, clinicId] as const,
    ),
    ['patient2', 'patient', clinicId],
    ['foreign', 'clinic_owner', otherClinicId],
  ] as [string, ClinicRole, string][]) {
    const email = `${label}@example.test`;
    const signUp = await provider.api.signUpEmail({
      body: { name: `Fictional ${label}`, email, password: fixturePassword },
    });
    const userId = signUp.user.id;
    await database.pool.query('UPDATE users SET email_verified=true WHERE id=$1', [userId]);
    const membershipId = randomUUID();
    await database.pool.query(
      "INSERT INTO memberships(id,clinic_id,user_id,status,joined_at) VALUES($1,$2,$3,'active',now())",
      [membershipId, clinic, userId],
    );
    await database.pool.query(
      'INSERT INTO membership_roles(clinic_id,membership_id,role_id) SELECT $1,$2,id FROM roles WHERE clinic_id=$1 AND key=$3',
      [clinic, membershipId, role],
    );
    if (role === 'dentist') {
      const staffId = randomUUID();
      providerId = randomUUID();
      await database.pool.query(
        "INSERT INTO staff(id,clinic_id,membership_id,kind) VALUES($1,$2,$3,'provider')",
        [staffId, clinic, membershipId],
      );
      await database.pool.query(
        "INSERT INTO providers(id,clinic_id,staff_id,provider_type) VALUES($1,$2,$3,'dentist')",
        [providerId, clinic, staffId],
      );
    }
    if (role === 'patient' || label === 'foreign') {
      const id = randomUUID();
      await database.pool.query(
        "INSERT INTO patients(id,clinic_id,portal_user_id,medical_record_number,given_name,family_name) VALUES($1,$2,$3,$4,'Fictional',$5)",
        [id, clinic, userId, label, label],
      );
      if (label === 'patient') patientId = id;
      else if (label === 'patient2') secondPatientId = id;
      else foreignPatientId = id;
    }
    const login = await mutation(
      app,
      origin,
      '/api/v1/auth/sign-in/email',
      { email, password: fixturePassword },
      '',
    );
    if (login.status !== 200) throw new Error(`Fixture sign-in failed: ${login.status}`);
    members[label] = {
      userId,
      membershipId,
      cookie: responseCookies(login).find((cookie) => cookie.includes('session_token=')) ?? '',
      email,
      clinicId: clinic,
    };
  }
  const dispose = async () => {
    await database.pool.end();
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  };
  return {
    authOptions,
    provider,
    app,
    origin,
    database,
    clinicId,
    otherClinicId,
    locationId,
    otherLocationId,
    typeId,
    otherTypeId,
    operatoryId,
    providerId,
    patientId,
    secondPatientId,
    foreignPatientId,
    members,
    dispose,
  };
}
