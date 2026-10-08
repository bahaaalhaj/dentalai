import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrateDatabase, seedDevelopmentDatabase } from '../src/migrations.js';

const adminUrl = process.env['DATABASE_URL'];

if (!adminUrl) {
  throw new Error(
    'DATABASE_URL is required for database integration tests. Point it at a disposable PostgreSQL instance.',
  );
}

const databaseName = `dentalai_test_${randomUUID().replaceAll('-', '')}`;
const adminPool = new Pool({ connectionString: adminUrl, max: 1 });
const testUrl = new URL(adminUrl);
testUrl.pathname = `/${databaseName}`;
const testPool = new Pool({ connectionString: testUrl.toString(), max: 4 });

const ids = {
  clinic: '10000000-0000-4000-8000-000000000001',
  location: '10000000-0000-4000-8000-000000000002',
  operatory: '10000000-0000-4000-8000-000000000003',
  membership: '10000000-0000-4000-8000-000000000006',
  provider: '10000000-0000-4000-8000-000000000008',
  patient: '10000000-0000-4000-8000-000000000009',
  secondPatient: '10000000-0000-4000-8000-000000000010',
  appointmentType: '10000000-0000-4000-8000-000000000012',
} as const;

async function expectPgError(query: Promise<unknown>, code: string): Promise<void> {
  await expect(query).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${databaseName}"`);
  await migrateDatabase(testUrl.toString());
  await seedDevelopmentDatabase(testUrl.toString());
});

afterAll(async () => {
  await testPool.end();
  await adminPool.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [databaseName],
  );
  await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await adminPool.end();
});

describe('migrations from zero', () => {
  it('creates the complete schema and records all four reviewed migrations', async () => {
    const tables = await testPool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const migrations = await testPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations',
    );

    expect(Number(tables.rows[0]?.count)).toBeGreaterThanOrEqual(45);
    expect(migrations.rows[0]?.count).toBe('4');
  });

  it('loads only explicitly fictional development identities and is idempotent', async () => {
    await seedDevelopmentDatabase(testUrl.toString());
    const result = await testPool.query<{ email: string }>(
      `SELECT email FROM users
       UNION ALL
       SELECT email FROM patients WHERE email IS NOT NULL`,
    );

    expect(result.rows).toHaveLength(3);
    expect(result.rows.every(({ email }) => email.endsWith('.invalid'))).toBe(true);
  });
});

describe('tenant and scheduling constraints', () => {
  it('rejects a cross-clinic patient reference', async () => {
    const otherClinic = randomUUID();
    await testPool.query(
      `INSERT INTO clinics (id, legal_name, display_name, slug, default_timezone, default_currency)
       VALUES ($1, 'Other Fictional Clinic', 'Other Fictional Clinic', $2, 'Etc/UTC', 'USD')`,
      [otherClinic, `other-${otherClinic.slice(0, 8)}`],
    );

    await expectPgError(
      testPool.query(
        `INSERT INTO medical_alerts (
           clinic_id, patient_id, severity, title, recorded_by_membership_id
         ) VALUES ($1, $2, 'warning', 'Cross-tenant test', $3)`,
        [otherClinic, ids.patient, ids.membership],
      ),
      '23503',
    );
  });

  it('rejects overlapping active appointments for the same provider', async () => {
    await expectPgError(
      testPool.query(
        `INSERT INTO appointments (
           clinic_id, location_id, operatory_id, patient_id, provider_id,
           appointment_type_id, starts_at, ends_at, timezone, created_by_membership_id
         ) VALUES ($1, $2, $3, $4, $5, $6,
           TIMESTAMPTZ '2030-01-07 09:15:00+00', TIMESTAMPTZ '2030-01-07 09:45:00+00',
           'Etc/UTC', $7)`,
        [
          ids.clinic,
          ids.location,
          ids.operatory,
          ids.secondPatient,
          ids.provider,
          ids.appointmentType,
          ids.membership,
        ],
      ),
      '23P01',
    );
  });

  it('rejects a schedule block that overlaps an active appointment resource', async () => {
    await expectPgError(
      testPool.query(
        `INSERT INTO schedule_blocks (
           clinic_id, location_id, provider_id, starts_at, ends_at, timezone, reason
         ) VALUES ($1, $2, $3,
           TIMESTAMPTZ '2030-01-07 09:10:00+00', TIMESTAMPTZ '2030-01-07 09:20:00+00',
           'Etc/UTC', 'Collision test')`,
        [ids.clinic, ids.location, ids.provider],
      ),
      '23P01',
    );
  });
});

describe('money and clinical constraints', () => {
  it('rejects non-positive money and non-ISO currency casing', async () => {
    await expectPgError(
      testPool.query(
        `INSERT INTO payments (
           clinic_id, patient_id, status, method, amount_minor, currency, recorded_by_membership_id
         ) VALUES ($1, $2, 'pending', 'cash', -1, 'USD', $3)`,
        [ids.clinic, ids.patient, ids.membership],
      ),
      '23514',
    );
    await expectPgError(
      testPool.query(
        `INSERT INTO payments (
           clinic_id, patient_id, status, method, amount_minor, currency, recorded_by_membership_id
         ) VALUES ($1, $2, 'pending', 'cash', 100, 'usd', $3)`,
        [ids.clinic, ids.patient, ids.membership],
      ),
      '23514',
    );
  });

  it('rejects blank required clinical facts', async () => {
    await expectPgError(
      testPool.query(
        `INSERT INTO allergies (
           clinic_id, patient_id, substance, recorded_by_membership_id
         ) VALUES ($1, $2, '   ', $3)`,
        [ids.clinic, ids.patient, ids.membership],
      ),
      '23514',
    );
    await expectPgError(
      testPool.query(
        `INSERT INTO odontogram_findings (
           clinic_id, patient_id, tooth_code, dentition, finding_code, recorded_by_membership_id
         ) VALUES ($1, $2, '', 'permanent', 'demo-finding', $3)`,
        [ids.clinic, ids.patient, ids.membership],
      ),
      '23514',
    );
  });

  it('keeps audit history append-only', async () => {
    const eventId = randomUUID();
    await testPool.query(
      `INSERT INTO audit_events (id, clinic_id, action, entity_type, data)
       VALUES ($1, $2, 'test.created', 'test', '{}'::jsonb)`,
      [eventId, ids.clinic],
    );

    await expectPgError(
      testPool.query('DELETE FROM audit_events WHERE id = $1', [eventId]),
      '55000',
    );
  });
});
