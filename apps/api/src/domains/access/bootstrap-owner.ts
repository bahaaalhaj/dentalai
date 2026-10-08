import { createDatabase } from '@dentalai/database';
import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvironment } from '../../config/environment.js';

try {
  loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const [clinicId, email] = process.argv.slice(2);
if (!clinicId || !email || !/^[0-9a-f-]{36}$/i.test(clinicId))
  throw new Error('Usage: npm run auth:bootstrap-owner -- <clinic-uuid> <verified-email>');
const { pool } = createDatabase(readEnvironment().databaseUrl);
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`owner:${clinicId}`]);
  const clinic = await client.query('SELECT id FROM clinics WHERE id=$1 AND active', [clinicId]);
  if (!clinic.rowCount)
    throw new Error('Active clinic not found. Clinic provisioning is an operator task.');
  const existing = await client.query(
    `SELECT 1 FROM memberships m JOIN membership_roles mr ON mr.clinic_id=m.clinic_id AND mr.membership_id=m.id JOIN roles r ON r.clinic_id=mr.clinic_id AND r.id=mr.role_id WHERE m.clinic_id=$1 AND r.key='clinic_owner'`,
    [clinicId],
  );
  if (existing.rowCount)
    throw new Error('An owner already exists. This command is initial provisioning only.');
  const user = await client.query<{ id: string }>(
    'SELECT id FROM users WHERE lower(email)=lower($1) AND email_verified AND disabled_at IS NULL',
    [email],
  );
  const userId = user.rows[0]?.id;
  if (!userId)
    throw new Error('Register and verify the patient account before operator provisioning.');
  await client.query(
    `INSERT INTO roles(clinic_id,key,name) SELECT $1,key,key FROM (VALUES ('clinic_owner'),('clinic_admin'),('dentist'),('receptionist'),('patient')) AS r(key) ON CONFLICT(clinic_id,key) DO NOTHING`,
    [clinicId],
  );
  const member = await client.query<{ id: string }>(
    `INSERT INTO memberships(clinic_id,user_id,status,joined_at) VALUES($1,$2,'active',now()) ON CONFLICT(clinic_id,user_id) DO UPDATE SET status='active' RETURNING id`,
    [clinicId, userId],
  );
  await client.query(
    `INSERT INTO membership_roles(clinic_id,membership_id,role_id) SELECT $1,$2,id FROM roles WHERE clinic_id=$1 AND key='clinic_owner' ON CONFLICT DO NOTHING`,
    [clinicId, member.rows[0]?.id],
  );
  await client.query(
    `INSERT INTO audit_events(clinic_id,actor_user_id,action,entity_type,data) VALUES($1,$2,'auth.owner_bootstrapped','membership','{"method":"operator_cli"}')`,
    [clinicId, userId],
  );
  await client.query('COMMIT');
  process.stdout.write('Initial clinic owner provisioned and audited.\n');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
