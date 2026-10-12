import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { encryptStream, decryptFile, readBackupKey } from './backup-lib.mjs';

test('backup key requires an explicit private file with a valid generated key', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dentalai-key-test-'));
  try {
    await assert.rejects(readBackupKey('relative-key'), /absolute private/);
    const keyFile = path.join(directory, 'key');
    const key = randomBytes(32);
    await writeFile(keyFile, key.toString('hex'), { mode: 0o600 });
    assert.deepEqual(await readBackupKey(keyFile), key);
    await writeFile(keyFile, 'not-a-key');
    await assert.rejects(readBackupKey(keyFile), /32-byte hex/);
    await assert.rejects(readBackupKey(directory), /private regular file/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('encrypted backup round trip, wrong key and tampered data fail closed', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dentalai-backup-test-'));
  try {
    const key = randomBytes(32);
    const encrypted = path.join(directory, 'encrypted');
    const output = path.join(directory, 'restored');
    const source = Buffer.from('Synthetic database dump and private object bytes');
    await encryptStream(Readable.from([source]), encrypted, key);
    assert.equal((await readFile(encrypted)).includes(source), false);
    await decryptFile(encrypted, output, key);
    assert.deepEqual(await readFile(output), source);
    const refused = path.join(directory, 'refused');
    await assert.rejects(decryptFile(encrypted, refused, randomBytes(32)), /authentication failed/);
    await assert.rejects(stat(refused), { code: 'ENOENT' });
    const tampered = await readFile(encrypted);
    tampered[25] ^= 1;
    await writeFile(encrypted, tampered);
    await assert.rejects(decryptFile(encrypted, refused, key), /authentication failed/);
    await assert.rejects(stat(refused), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('SAST gate refuses missing evidence and high/critical findings', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dentalai-sast-test-'));
  try {
    const run = () =>
      spawnSync(process.execPath, ['scripts/check-sarif.mjs', directory], { encoding: 'utf8' })
        .status;
    assert.equal(run(), 1);
    await writeFile(
      path.join(directory, 'synthetic-test.sarif'),
      JSON.stringify({
        runs: [
          {
            tool: {
              driver: {
                rules: [{ id: 'synthetic-fixture', properties: { 'security-severity': '8.0' } }],
              },
            },
            results: [{ ruleId: 'synthetic-fixture', level: 'warning' }],
          },
        ],
      }),
    );
    assert.equal(run(), 1);
    await writeFile(
      path.join(directory, 'synthetic-test.sarif'),
      JSON.stringify({ runs: [{ tool: { driver: { rules: [] } }, results: [] }] }),
    );
    assert.equal(run(), 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
