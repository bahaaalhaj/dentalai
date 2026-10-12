// Disposable, synthetic-only integration drill of the ACTUAL pilot backup/restore commands.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { migrateDatabase } from '@dentalai/database';
import { seedLocalDevelopment } from '../apps/api/dist/development/seed.js';
import sharp from 'sharp';

const suffix = randomUUID().slice(0, 8);
const root = path.resolve('.local', `phase14-restore-${suffix}`);
await mkdir(root, { recursive: true, mode: 0o700 });
const keyFile = path.join(root, 'backup-key');
await writeFile(keyFile, randomBytes(32).toString('hex'), { mode: 0o600 });
const identity = '10000000-0000-4000-8000-000000000001';
const patient = '10000000-0000-4000-8000-000000000009';
const generatedPassword = randomBytes(24).toString('hex');
function run(executable, args, env, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let text = '';
    child.stdout.on('data', (chunk) => {
      text += chunk;
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.once('error', () => reject(new Error('Drill command could not start')));
    child.once('close', (code) =>
      code === 0
        ? resolve(text)
        : reject(
            new Error(
              `Drill command failed (${executable}, exit ${code}); private evidence retained in ${root}.`,
            ),
          ),
    );
    child.stdin.end(input);
  });
}
async function prepare(kind, port) {
  const project = `dentalai-drill-${kind}-${suffix}`;
  const secrets = path.join(root, kind);
  await mkdir(secrets, { mode: 0o700 });
  const adminPassword = randomBytes(24).toString('hex');
  const appPassword = randomBytes(24).toString('hex');
  const secretValues = {
    postgres_password: adminPassword,
    database_url: `postgresql://dentalai_app:${appPassword}@postgres/dentalai`,
    migration_database_url: `postgresql://dentalai_migrator:${adminPassword}@postgres/dentalai`,
    auth_secret: randomBytes(32).toString('hex'),
    smtp_url: 'smtps://unused-provider.example.invalid',
    monitoring_token: randomBytes(32).toString('hex'),
  };
  for (const [name, value] of Object.entries(secretValues))
    await writeFile(path.join(secrets, name), value, { mode: 0o600 });
  const env = {
    SECRETS_DIRECTORY: secrets,
    RELEASE_TAG: 'phase14',
    DEPLOYMENT_ENV: 'staging',
    APP_ORIGIN: 'https://fixture.example.invalid',
    MAIL_FROM: 'fixture@example.invalid',
    PILOT_HTTP_PORT: String(port),
  };
  const compose = [
    'compose',
    '-p',
    project,
    '-f',
    'infra/compose.pilot.yml',
    '-f',
    'infra/compose.drill.yml',
  ];
  try {
    await run('docker', [...compose, 'up', '-d', '--wait', 'postgres'], env);
    const address = (await run('docker', [...compose, 'port', 'postgres', '5432'], env)).trim();
    const db = `postgresql://dentalai_migrator:${adminPassword}@${address}/dentalai`;
    const pool = new Pool({ connectionString: db });
    await pool.query(
      `CREATE ROLE dentalai_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${appPassword}'`,
    );
    return { project, env, compose, pool, db };
  } catch (error) {
    await run('docker', [...compose, 'down'], env);
    throw error;
  }
}
let source;
let destination;
try {
  source = await prepare('source', 15320);
  destination = await prepare('destination', 15321);
  await migrateDatabase(source.db);
  await seedLocalDevelopment(source.db, generatedPassword, 'test');
  await seedLocalDevelopment(source.db, generatedPassword, 'test');
  await source.pool.query(await readFile('infra/runtime-grants.sql', 'utf8'));
  await run('docker', [...source.compose, 'up', '-d', '--wait', 'api'], source.env);
  await run(process.execPath, ['scripts/smoke-staging.mjs', '--allow-local'], {
    ...source.env,
    SMOKE_ORIGIN: 'http://127.0.0.1:15320',
  });
  const cookies = new Map();
  let activeOrigin = 'http://127.0.0.1:15320';
  async function call(endpoint, body) {
    const csrf = await fetch(`${activeOrigin}/api/v1/access/csrf`);
    const token = (await csrf.json()).token;
    for (const value of csrf.headers.getSetCookie())
      cookies.set(value.split('=')[0], value.split(';')[0]);
    const response = await fetch(`${activeOrigin}${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        origin: source.env.APP_ORIGIN,
        cookie: [...cookies.values()].join('; '),
        'x-csrf-token': token,
        ...(Buffer.isBuffer(body)
          ? {
              'content-type': 'image/png',
              'x-imaging-reason': 'Synthetic restore drill fixture; no patient image',
            }
          : { 'content-type': 'application/json' }),
      },
      ...(body ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}),
    });
    for (const value of response.headers.getSetCookie())
      cookies.set(value.split('=')[0], value.split(';')[0]);
    assert.ok(response.ok, `Synthetic API call failed (${response.status})`);
    return response;
  }
  await call('/api/v1/auth/sign-in/email', {
    email: 'dentist@example.invalid',
    password: generatedPassword,
  });
  const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
  const uploaded = await (await call(`/api/v1/imaging/patients/${patient}/images`, image)).json();
  const key = await source.pool.query(
    'SELECT object_key,storage_provider FROM files WHERE clinic_id=$1 AND status=$$available$$',
    [identity],
  );
  assert.ok(
    key.rows.some(
      (row) =>
        row.object_key.startsWith(`clinical/${identity}/`) &&
        row.storage_provider === 'filesystem-private',
    ),
  );
  const content = Buffer.from(
    await (await call(`/api/v1/imaging/images/${uploaded.id}/content`)).arrayBuffer(),
  );
  const checksum = createHash('sha256').update(content).digest('hex');
  const backups = path.join(root, 'backups');
  const backupOutput = await run(
    process.execPath,
    [
      'scripts/backup.mjs',
      'create',
      '--project',
      source.project,
      '--key-file',
      keyFile,
      '--output',
      backups,
    ],
    source.env,
  );
  const bundle = backupOutput.match(/Encrypted quiesced backup complete: (.+)/)?.[1]?.trim();
  assert.ok(bundle);
  await run(
    process.execPath,
    [
      'scripts/backup.mjs',
      'restore',
      '--project',
      destination.project,
      '--key-file',
      keyFile,
      '--bundle',
      bundle,
      '--ack-empty',
    ],
    destination.env,
  );
  assert.equal(
    (await destination.pool.query('SELECT count(*)::int AS n FROM auth_sessions')).rows[0].n,
    0,
  );
  assert.equal(
    (await destination.pool.query('SELECT default_currency FROM clinics WHERE id=$1', [identity]))
      .rows[0].default_currency,
    'SYP',
  );
  await destination.pool.query(await readFile('infra/runtime-grants.sql', 'utf8'));
  await run('docker', [...destination.compose, 'up', '-d', '--wait', 'api'], destination.env);
  await run(process.execPath, ['scripts/smoke-staging.mjs', '--allow-local'], {
    ...destination.env,
    SMOKE_ORIGIN: 'http://127.0.0.1:15321',
  });
  activeOrigin = 'http://127.0.0.1:15321';
  cookies.clear();
  await call('/api/v1/auth/sign-in/email', {
    email: 'dentist@example.invalid',
    password: generatedPassword,
  });
  const restoredImage = Buffer.from(
    await (await call(`/api/v1/imaging/images/${uploaded.id}/content`)).arrayBuffer(),
  );
  assert.equal(createHash('sha256').update(restoredImage).digest('hex'), checksum);
  const counts = (
    await destination.pool.query(
      'SELECT (SELECT count(*) FROM patients)::int AS patients,(SELECT count(*) FROM appointments)::int AS appointments,(SELECT count(*) FROM billing_ledger)::int AS ledger_events,(SELECT count(*) FROM clinical_revisions)::int AS clinical_revisions,(SELECT count(*) FROM files WHERE status=$$available$$)::int AS available_files',
    )
  ).rows[0];
  await writeFile(
    path.join(root, 'drill-result.json'),
    JSON.stringify(
      { status: 'pass', counts, syntheticFileChecksum: checksum, backupBundle: bundle },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    `Synthetic clean-environment restore drill passed: ${JSON.stringify(counts)}. Encrypted backup/evidence retained at ${root}.`,
  );
} finally {
  for (const instance of [source, destination])
    if (instance) {
      await instance.pool.end();
      // Stop only the two UUID-named disposable drill projects. Volumes/backups stay recoverable.
      await run('docker', [...instance.compose, 'down'], instance.env);
    }
}
