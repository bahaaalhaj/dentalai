import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { FilesystemPrivateStorage } from '../../src/domains/imaging/filesystem-storage.js';
import { readEnvironment } from '../../src/config/environment.js';
it('stores actual private bytes without overwriting versions or accepting traversal', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dentalai-private-test-'));
  try {
    const storage = new FilesystemPrivateStorage(directory);
    const key = `clinical/${randomUUID()}/${randomUUID()}.png`;
    await storage.put(key, Buffer.from('synthetic test bytes'), 'image/png');
    expect(await storage.get(key)).toEqual(Buffer.from('synthetic test bytes'));
    await storage.put(key, Buffer.from('synthetic test bytes'), 'image/png');
    await expect(storage.put(key, Buffer.from('different'), 'image/png')).rejects.toThrow(
      'Immutable',
    );
    await expect(storage.get('../../public/image.png')).rejects.toThrow('Invalid');
    await expect(storage.put(key, Buffer.from('svg'), 'image/svg+xml')).rejects.toThrow('Invalid');
    expect(() => new FilesystemPrivateStorage(path.join(directory, 'public'))).toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it('requires explicit configuration and never falls back from S3', () => {
  const env = {
    DATABASE_URL: 'postgresql://localhost/dentalai_test',
    CLINICAL_STORAGE_ENABLED: 'true',
  };
  expect(() => readEnvironment(env)).toThrow();
  expect(() => readEnvironment({ ...env, STORAGE_DRIVER: 'filesystem' })).toThrow();
  expect(
    readEnvironment({ ...env, STORAGE_DRIVER: 'filesystem', PRIVATE_STORAGE_DIRECTORY: tmpdir() }),
  ).toMatchObject({ storageDriver: 'filesystem' });
});
it('honors cancellation before opening or writing a private object', async () => {
  const storage = new FilesystemPrivateStorage(
    path.join(tmpdir(), `dentalai-aborted-${randomUUID()}`),
  );
  const key = `clinical/${randomUUID()}/${randomUUID()}.png`,
    signal = AbortSignal.abort();
  await expect(
    storage.put(key, Buffer.from('synthetic'), 'image/png', signal),
  ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  await expect(storage.get(key, signal)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
});
