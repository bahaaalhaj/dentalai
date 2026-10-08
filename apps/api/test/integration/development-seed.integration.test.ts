import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import pino from 'pino';
import request from 'supertest';
import sharp from 'sharp';
import { createDatabase, migrateDatabase } from '@dentalai/database';
import { createApplication } from '../../src/app.js';
import { createAuthProvider } from '../../src/domains/auth/auth.provider.js';
import { AccessRepository } from '../../src/domains/access/access.repository.js';
import { PostgresSystemRepository } from '../../src/domains/system/system.repository.js';
import { SystemService } from '../../src/domains/system/system.service.js';
import { ApplicationLifecycle } from '../../src/infrastructure/lifecycle.js';
import { FilesystemPrivateStorage } from '../../src/domains/imaging/filesystem-storage.js';
import {
  seedLocalDevelopment,
  developmentAccounts,
  developmentId,
  developmentClinicId,
  assertLocalDevelopmentDatabase,
} from '../../src/development/seed.js';
import { mutation, responseCookies } from '../support/scheduling-fixture.js';

const password = 'Fictional-only-test-credential-2026!';
const origin = 'https://reset.example.test';
const name = `dentalai_reset_${randomUUID().replaceAll('-', '')}`;
let admin: Pool, database: ReturnType<typeof createDatabase>, url: string, directory: string;
let app: Awaited<ReturnType<typeof createApplication>>;
const cookies = new Map<string, string>();
async function snapshot() {
  const tables = await database.pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
  );
  const result: Record<string, unknown> = {};
  for (const { table_name: table } of tables.rows) {
    if (!/^[a-z_]+$/.test(table)) throw new Error('Unexpected table name');
    result[table] = (
      await database.pool.query(
        `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
      )
    ).rows;
  }
  return result;
}
beforeAll(async () => {
  const adminUrl = process.env['DATABASE_URL'];
  if (!adminUrl) throw new Error('Disposable PostgreSQL DATABASE_URL required');
  admin = new Pool({ connectionString: adminUrl });
  await admin.query(`CREATE DATABASE "${name}"`);
  const target = new URL(adminUrl);
  target.pathname = `/${name}`;
  url = target.toString();
  await migrateDatabase(url);
  database = createDatabase(url);
  directory = await mkdtemp(path.join(os.tmpdir(), 'dentalai-reset-private-'));
});
afterAll(async () => {
  await database?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe('approved test-data reset, real PostgreSQL and private local storage', () => {
  it('guards development-only local seeding without touching remote or maintenance databases', () => {
    expect(() => assertLocalDevelopmentDatabase(url, 'production')).toThrow();
    expect(() =>
      assertLocalDevelopmentDatabase('postgresql://example.invalid/demo', 'development'),
    ).toThrow();
    expect(() =>
      assertLocalDevelopmentDatabase('postgresql://localhost/postgres', 'development'),
    ).toThrow();
  });
  it('seeds from zero twice without changing any row or password hash; tenant and SYP values are explicit', async () => {
    await seedLocalDevelopment(url, password, 'test');
    const first = await snapshot();
    await seedLocalDevelopment(url, password, 'test');
    expect(await snapshot()).toEqual(first);
    const tenantTables = await database.pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='clinic_id'",
    );
    for (const { table_name: table } of tenantTables.rows)
      expect(
        (
          await database.pool.query(
            `SELECT 1 FROM "${table}" WHERE clinic_id IS DISTINCT FROM $1`,
            [developmentClinicId],
          )
        ).rowCount,
        table,
      ).toBe(0);
    expect((await database.pool.query('SELECT default_currency FROM clinics')).rows).toEqual([
      { default_currency: 'SYP' },
    ]);
    expect(
      (
        await database.pool.query(
          'SELECT amount_minor,currency FROM price_list_items ORDER BY amount_minor',
        )
      ).rows,
    ).toEqual(
      [50000, 100000, 150000, 450000, 800000, 1200000].map((amount_minor) => ({
        amount_minor: String(amount_minor),
        currency: 'SYP',
      })),
    );
    for (const [table, count] of [
      ['users', 6],
      ['patients', 2],
      ['appointments', 3],
      ['services', 6],
      ['invoices', 2],
      ['payments', 1],
      ['clinical_revisions', 4],
      ['xray_studies', 1],
      ['files', 0],
      ['ai_analysis_runs', 0],
    ] as const)
      expect(
        Number((await database.pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count),
        table,
      ).toBe(count);
  });
  it('refuses an existing USD tenant without relabeling currency or changing any row', async () => {
    await database.pool.query("UPDATE clinics SET default_currency='USD' WHERE id=$1", [
      developmentClinicId,
    ]);
    try {
      const before = await snapshot();
      await expect(seedLocalDevelopment(url, password, 'test')).rejects.toThrow(
        'no currency relabeling',
      );
      expect(await snapshot()).toEqual(before);
    } finally {
      await database.pool.query("UPDATE clinics SET default_currency='SYP' WHERE id=$1", [
        developmentClinicId,
      ]);
    }
  });
  it('authenticates every seeded role through the real server-owned sessions and API replacements', async () => {
    const authOptions = {
      secret: randomUUID() + randomUUID(),
      origin,
      sendMail: async () => undefined,
    };
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
        rateLimitMax: 10000,
        rateLimitWindowMs: 60000,
      },
      authentication: {
        provider: createAuthProvider(database.db, authOptions),
        repository: new AccessRepository(database.pool, database.db),
        options: authOptions,
      },
      imaging: { storage: new FilesystemPrivateStorage(directory) },
    });
    for (const account of developmentAccounts) {
      const login = await mutation(
        app,
        origin,
        '/api/v1/auth/sign-in/email',
        { email: account.email, password },
        '',
      );
      expect(login.status, JSON.stringify(login.body)).toBe(200);
      const cookie = responseCookies(login).join('; ');
      cookies.set(account.email, cookie);
      const identity = await request(app)
        .get('/api/v1/access/me')
        .set('cookie', cookie)
        .expect(200);
      expect(identity.body.activeMembership.clinicId).toBe(developmentClinicId);
      expect(identity.body.activeMembership.roles).toContain(account.role);
    }
    const dentist = cookies.get('dentist@example.invalid')!;
    await request(app).get('/api/v1/clinical/patients').set('cookie', dentist).expect(200);
    const workspace = await request(app)
      .get(`/api/v1/clinical/patients/${developmentId(9)}`)
      .set('cookie', dentist);
    expect(workspace.status, JSON.stringify(workspace.body)).toBe(200);
    await request(app)
      .get('/api/v1/billing/catalog')
      .set('cookie', cookies.get('owner@example.invalid')!)
      .expect(200);
    const portal = await request(app)
      .get('/api/v1/billing/portal')
      .set('cookie', cookies.get('patient@example.invalid')!)
      .expect(200);
    expect(JSON.stringify(portal.body)).toContain('30000');
    await request(app)
      .get('/api/v1/clinical/portal')
      .set('cookie', cookies.get('patient@example.invalid')!)
      .expect(200);
    await request(app)
      .get(`/api/v1/anesthesia/patients/${developmentId(9)}`)
      .set('cookie', dentist)
      .expect(200);
    expect(
      (
        await mutation(
          app,
          origin,
          `/api/v1/anesthesia/assessments/${developmentId(81)}/confirm`,
          { reason: 'Synthetic software check' },
          dentist,
        )
      ).status,
    ).toBe(409);
  });
  it('uses actual private filesystem objects with authorized streams, preserved versions and unavailable inference', async () => {
    const dentist = cookies.get('dentist@example.invalid')!;
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'white' } })
      .png()
      .toBuffer();
    async function upload(study?: string) {
      const csrf = await request(app).get('/api/v1/access/csrf').expect(200);
      return request(app)
        .post(
          `/api/v1/imaging/patients/${developmentId(9)}/images${study ? `?studyId=${study}` : ''}`,
        )
        .set('origin', origin)
        .set('cookie', [dentist, ...responseCookies(csrf)].join('; '))
        .set('x-csrf-token', String(csrf.body.token))
        .set('content-type', 'image/png')
        .set('x-imaging-reason', 'Synthetic technical fixture')
        .send(png);
    }
    const first = await upload();
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await upload(first.body.studyId);
    expect(second.status).toBe(201);
    expect(second.body.version).toBe(2);
    await request(app).get(`/api/v1/imaging/images/${first.body.id}/content`).expect(401);
    await request(app)
      .get(`/api/v1/imaging/images/${first.body.id}/content`)
      .set('cookie', cookies.get('patient@example.invalid')!)
      .expect(403);
    await request(app)
      .get(`/api/v1/imaging/images/${first.body.id}/content`)
      .set('cookie', dentist)
      .expect(200)
      .expect('cache-control', 'private, no-store');
    const analysis = await mutation(
      app,
      origin,
      `/api/v1/imaging/images/${first.body.id}/analyses`,
      { reason: 'Synthetic technical fixture' },
      dentist,
    );
    expect(analysis.status).toBe(503);
    const history = await request(app)
      .get(`/api/v1/imaging/patients/${developmentId(9)}`)
      .set('cookie', dentist)
      .expect(200);
    expect(history.body.images).toHaveLength(2);
    expect(history.body.analyses).toHaveLength(1);
    expect(history.body.analyses[0].status).toBe('failed');
    expect(history.body.analyses[0].result).toBeNull();
  });
});
