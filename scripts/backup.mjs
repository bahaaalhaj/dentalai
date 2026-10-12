// Operator-only, quiesced pilot filesystem backups. Does NOT support S3 snapshots.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, chmod, readFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { encryptStream, decryptFile, readBackupKey } from './backup-lib.mjs';

const [action, ...args] = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const project = option('--project');
if (
  !['create', 'restore'].includes(action) ||
  !/^[a-z][a-z0-9-]{2,60}$/.test(project ?? '') ||
  !args.includes('--key-file')
)
  throw new Error(
    'Use backup create|restore --project NAME --key-file ABSOLUTE_PATH --output ABSOLUTE_DIR or --bundle ABSOLUTE_DIR.',
  );
const key = await readBackupKey(option('--key-file'));
const compose = ['compose', '-p', project, '-f', 'infra/compose.pilot.yml'];
function command(parameters, input) {
  const child = spawn('docker', [...compose, ...parameters], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume(); // Never echo connection strings, dump content or operator secrets.
  child.stdin.on('error', () => {}); // Docker exit is reported through done, never raw EPIPE/input.
  const done = new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('Docker command failed')));
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error('Docker backup/restore command failed')),
    );
  });
  // Mark rejection handled immediately while stdout is piped; still awaited by caller.
  void done.catch(() => {});
  if (input) {
    input.pipe(child.stdin);
    input.once('error', () => child.kill());
  } else child.stdin.end();
  return { stream: child.stdout, done };
}
async function collect(parameters) {
  const { stream, done } = command(parameters);
  let text = '';
  for await (const chunk of stream) {
    text += chunk;
    if (text.length > 1000000) throw new Error('Unexpected command output');
  }
  await done;
  return text;
}
async function encryptedCommand(parameters, destination) {
  const { stream, done } = command(parameters);
  await encryptStream(stream, destination, key);
  await done;
}
const pg = (sql) =>
  collect([
    'exec',
    '-T',
    'postgres',
    'sh',
    '-ec',
    `psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc '${sql}'`,
  ]);
const countsSQL = `SELECT json_build_object(${['clinics', 'patients', 'appointments', 'clinical_revisions', 'billing_ledger', 'files', 'audit_events'].map((table) => `$$${table}$$,(SELECT count(*) FROM ${table})`).join(',')})`;
const hash = async (file) => {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
};
const absolute = (value) => {
  if (!value || !path.isAbsolute(value) || path.resolve(value) === path.parse(value).root)
    throw new Error('Use an explicit private, non-root absolute directory.');
  return path.resolve(value);
};
const running = (await collect(['ps', '--status', 'running', '--services'])).trim().split(/\s+/);
if (!running.includes('postgres'))
  throw new Error('Destination/source PostgreSQL must be running.');

if (action === 'create') {
  const root = absolute(option('--output'));
  await mkdir(root, { recursive: true, mode: 0o700 });
  const bundle = path.join(
    root,
    `dentalai-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`,
  );
  await mkdir(bundle, { mode: 0o700 });
  const wasRunning = running.includes('api');
  try {
    if (wasRunning) await collect(['stop', 'api']);
    const counts = JSON.parse((await pg(countsSQL)).trim());
    const files = JSON.parse(
      (
        await collect([
          'run',
          '--rm',
          '--no-deps',
          '-T',
          '--entrypoint',
          'node',
          'api',
          'scripts/check-private-files.mjs',
        ])
      ).trim(),
    );
    await encryptedCommand(
      [
        'exec',
        '-T',
        'postgres',
        'sh',
        '-ec',
        'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl',
      ],
      path.join(bundle, 'database.enc'),
    );
    await encryptedCommand(
      [
        'run',
        '--rm',
        '--no-deps',
        '-T',
        '--entrypoint',
        'tar',
        'api',
        '-C',
        '/private',
        '-cf',
        '-',
        'objects',
      ],
      path.join(bundle, 'objects.enc'),
    );
    const manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      adapter: 'filesystem',
      counts,
      files,
      databaseSha256: await hash(path.join(bundle, 'database.enc')),
      objectsSha256: await hash(path.join(bundle, 'objects.enc')),
    };
    await encryptStream(
      Readable.from([JSON.stringify(manifest)]),
      path.join(bundle, 'manifest.enc'),
      key,
    );
    console.log(`Encrypted quiesced backup complete: ${bundle}`);
    console.log(
      'Retention: 30 daily / 12 monthly; copy off-host and verify a restore before pruning.',
    );
  } finally {
    if (wasRunning) await collect(['start', 'api']);
  }
} else {
  if (!args.includes('--ack-empty') || running.includes('api'))
    throw new Error(
      'Restore requires stopped API, a NEW empty database/object volume and --ack-empty.',
    );
  const bundle = absolute(option('--bundle'));
  if (
    (
      await pg('SELECT count(*) FROM information_schema.tables WHERE table_schema=$$public$$')
    ).trim() !== '0'
  )
    throw new Error('Refusing restore into a nonempty database.');
  const objects = await collect([
    'run',
    '--rm',
    '--no-deps',
    '-T',
    '--entrypoint',
    'find',
    'api',
    '/private/objects',
    '-type',
    'f',
  ]);
  if (objects.trim()) throw new Error('Refusing restore into a nonempty object volume.');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dentalai-restore-'));
  await chmod(temporary, 0o700);
  try {
    await decryptFile(
      path.join(bundle, 'manifest.enc'),
      path.join(temporary, 'manifest.json'),
      key,
    );
    const manifest = JSON.parse(await readFile(path.join(temporary, 'manifest.json'), 'utf8'));
    if (
      manifest.version !== 1 ||
      manifest.adapter !== 'filesystem' ||
      manifest.databaseSha256 !== (await hash(path.join(bundle, 'database.enc'))) ||
      manifest.objectsSha256 !== (await hash(path.join(bundle, 'objects.enc')))
    )
      throw new Error('Backup manifest/checksum mismatch');
    for (const name of ['database', 'objects'])
      await decryptFile(path.join(bundle, `${name}.enc`), path.join(temporary, name), key);
    const listing = command(
      ['run', '--rm', '--no-deps', '-T', '--entrypoint', 'tar', 'api', '-tvf', '-'],
      createReadStream(path.join(temporary, 'objects')),
    );
    let list = '';
    for await (const chunk of listing.stream) list += chunk;
    await listing.done;
    if (
      list
        .split('\n')
        .filter(Boolean)
        .some(
          (line) =>
            !/^[d-]/.test(line) ||
            !/ objects\/(?:clinical\/(?:[a-f0-9-]{36}\/(?:[a-f0-9-]{36}\.png)?)?)?$/.test(line),
        )
    )
      throw new Error('Unsafe object archive paths or links');
    const restore = command(
      [
        'exec',
        '-T',
        'postgres',
        'sh',
        '-ec',
        'pg_restore --exit-on-error --single-transaction --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
      ],
      createReadStream(path.join(temporary, 'database')),
    );
    restore.stream.resume();
    await restore.done;
    // Dumps deliberately omit ACLs. Reapply the reviewed restricted role grants
    // before the application identity reconciles files; never grant ownership.
    const grants = command(
      [
        'exec',
        '-T',
        'postgres',
        'sh',
        '-ec',
        'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
      ],
      Readable.from([await readFile('infra/runtime-grants.sql', 'utf8')]),
    );
    grants.stream.resume();
    await grants.done;
    const extract = command(
      [
        'run',
        '--rm',
        '--no-deps',
        '-T',
        '--entrypoint',
        'tar',
        'api',
        '-C',
        '/private',
        '-xf',
        '-',
        '--no-same-owner',
      ],
      createReadStream(path.join(temporary, 'objects')),
    );
    extract.stream.resume();
    await extract.done;
    if (
      JSON.stringify(JSON.parse((await pg(countsSQL)).trim())) !== JSON.stringify(manifest.counts)
    )
      throw new Error('Restored row counts differ; keep destination isolated.');
    const files = JSON.parse(
      (
        await collect([
          'run',
          '--rm',
          '--no-deps',
          '-T',
          '--entrypoint',
          'node',
          'api',
          'scripts/check-private-files.mjs',
        ])
      ).trim(),
    );
    if (JSON.stringify(files) !== JSON.stringify(manifest.files))
      throw new Error('Restored private file counts/checksums differ; keep destination isolated.');
    // Restores never reactivate previously backed-up sessions or pending token deliveries.
    await pg(
      'TRUNCATE auth_sessions,auth_verifications; UPDATE outbox_jobs SET status=$$failed$$,attempts=8,last_error=$$RESTORE_REQUIRES_REVIEW$$ WHERE status<>$$completed$$',
    );
    console.log(
      'Restore authenticated; row-count reconciliation passed. Sessions revoked. Keep isolated pending file checksum/domain smoke checks and operator approval.',
    );
  } finally {
    // Only this exact mkdtemp-created, private directory is removed.
    const safeTemporary =
      path.dirname(temporary) === os.tmpdir() &&
      path.basename(temporary).startsWith('dentalai-restore-');
    if (safeTemporary) await rm(temporary, { recursive: true, force: true });
  }
}
// Retention pruning is deliberately an operator workflow, not unverified recursive deletion.
