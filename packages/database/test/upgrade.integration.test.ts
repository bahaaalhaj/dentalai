import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { migrateDatabase, migrationsFolder, seedDevelopmentDatabase } from '../src/migrations.js';

const adminUrl = process.env['DATABASE_URL'];
if (!adminUrl) throw new Error('DATABASE_URL must point to disposable PostgreSQL.');
const clinicId = '10000000-0000-4000-8000-000000000001';
const patientId = '10000000-0000-4000-8000-000000000009';
const providerId = '10000000-0000-4000-8000-000000000008';
const membershipId = '10000000-0000-4000-8000-000000000006';
const appointmentId = '10000000-0000-4000-8000-000000000016';

async function upgradeFixture(prefix: number, test: (pool: Pool, url: string) => Promise<void>) {
  const name = `dentalai_upgrade_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(adminUrl!);
  url.pathname = `/${name}`;
  const admin = new Pool({ connectionString: adminUrl });
  const pool = new Pool({ connectionString: url.toString() });
  const folder = await mkdtemp(path.join(tmpdir(), 'dentalai-reviewed-migrations-'));
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    const journal = JSON.parse(
      await readFile(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
    ) as {
      entries: { tag: string }[];
    };
    journal.entries = journal.entries.slice(0, prefix);
    await mkdir(path.join(folder, 'meta'));
    await writeFile(path.join(folder, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
      await cp(
        path.join(migrationsFolder, `${entry.tag}.sql`),
        path.join(folder, `${entry.tag}.sql`),
      );
    await migrateDatabase(url.toString(), folder);
    await seedDevelopmentDatabase(url.toString());
    await test(pool, url.toString());
  } finally {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
    // Only this mkdtemp-created fixture directory is removed, never repository migrations/data.
    await rm(folder, { recursive: true, force: true });
  }
}
describe('reviewed incremental upgrades', () => {
  it('upgrades the Phase 6 schema without losing appointments, notes, sessions or audit history', async () => {
    await upgradeFixture(3, async (pool, url) => {
      const encounter = randomUUID();
      const note = randomUUID();
      const session = randomUUID();
      await pool.query(
        'INSERT INTO encounters(id,clinic_id,patient_id,provider_id,started_at) VALUES($1,$2,$3,$4,now())',
        [encounter, clinicId, patientId, providerId],
      );
      await pool.query(
        "INSERT INTO clinical_notes(id,clinic_id,patient_id,encounter_id,note_group_id,version,status,note_type,body,authored_by_membership_id,signed_at) VALUES($1,$2,$3,$4,$1,1,'signed','progress','Fictional retained note',$5,now())",
        [note, clinicId, patientId, encounter, membershipId],
      );
      const userId = '10000000-0000-4000-8000-000000000004';
      await pool.query(
        "INSERT INTO auth_sessions(id,user_id,token,expires_at,created_at,updated_at) VALUES($1,$2,$3,now()+interval '1 day',now(),now())",
        [session, userId, randomUUID()],
      );
      await pool.query(
        "INSERT INTO audit_events(clinic_id,action,entity_type) VALUES($1,'review.retained','test')",
        [clinicId],
      );
      await migrateDatabase(url);
      await migrateDatabase(url); // Idempotent rerun must not add history or rebuild tables.
      expect(
        (await pool.query('SELECT 1 FROM appointments WHERE id=$1', [appointmentId])).rowCount,
      ).toBe(1);
      expect(
        (await pool.query('SELECT body FROM clinical_notes WHERE id=$1', [note])).rows[0]?.body,
      ).toBe('Fictional retained note');
      expect(
        (await pool.query('SELECT 1 FROM auth_sessions WHERE id=$1', [session])).rowCount,
      ).toBe(1);
      expect(
        (await pool.query("SELECT 1 FROM audit_events WHERE action='review.retained'")).rowCount,
      ).toBe(1);
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations'))
          .rows[0]?.count,
      ).toBe(6);
    });
  });
  it('rolls back the entire repair when inconsistent existing data requires manual reconciliation', async () => {
    await upgradeFixture(4, async (pool, url) => {
      const encounter = randomUUID();
      await pool.query(
        'INSERT INTO encounters(id,clinic_id,patient_id,appointment_id,provider_id,started_at) VALUES($1,$2,$3,$4,$5,now())',
        [encounter, clinicId, '10000000-0000-4000-8000-000000000010', appointmentId, providerId],
      );
      await expect(migrateDatabase(url)).rejects.toThrow();
      expect((await pool.query('SELECT 1 FROM encounters WHERE id=$1', [encounter])).rowCount).toBe(
        1,
      );
      expect(
        (await pool.query("SELECT to_regclass('appointments_clinic_id_patient_uidx') AS index"))
          .rows[0]?.index,
      ).toBeNull();
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations'))
          .rows[0]?.count,
      ).toBe(4);
    });
  });
});
