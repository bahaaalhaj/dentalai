import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configureLocalDevelopment } from '../../src/development/configure.js';
it('generates private local settings once, with fresh secrets and no overwrites', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dentalai-config-'));
  try {
    await configureLocalDevelopment(directory);
    const original = await readFile(path.join(directory, '.env'), 'utf8');
    expect(original).toContain('MAIL_DRIVER=filesystem');
    expect(original).toContain('STORAGE_DRIVER=filesystem');
    expect(original).toContain('XRAY_INFERENCE_ENABLED=false');
    expect(original).not.toContain('VITE_DATABASE_URL');
    await expect(configureLocalDevelopment(directory)).rejects.toThrow('nothing was overwritten');
    expect(await readFile(path.join(directory, '.env'), 'utf8')).toBe(original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
