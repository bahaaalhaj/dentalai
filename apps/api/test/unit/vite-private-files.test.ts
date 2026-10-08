import { expect, it, vi } from 'vitest';
import { createServer } from 'vite';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

it('the actual Vite development server denies private credentials, custom storage and mailbox files', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
  await mkdir(path.join(root, '.local'), { recursive: true });
  const directory = await mkdtemp(path.join(root, '.local', 'vite-deny-'));
  const custom = await mkdtemp(path.join(root, 'infra', 'vite-deny-'));
  const marker = 'synthetic-private-file-must-not-be-served';
  vi.stubEnv('PRIVATE_STORAGE_DIRECTORY', custom);
  vi.stubEnv('PRIVATE_MAIL_DIRECTORY', custom);
  const server = await createServer({
    root: path.join(root, 'apps/web'),
    configFile: path.join(root, 'apps/web/vite.config.ts'),
    server: { host: '127.0.0.1', port: 0, watch: null },
    logLevel: 'silent',
  });
  try {
    await writeFile(path.join(directory, 'credential.json'), marker);
    await writeFile(path.join(custom, 'object.png'), marker);
    await writeFile(path.join(custom, 'reset.json'), marker);
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing local Vite address');
    for (const file of [
      path.join(directory, 'credential.json'),
      path.join(custom, 'object.png'),
      path.join(custom, 'reset.json'),
    ]) {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/@fs/${file.replaceAll('\\', '/')}`,
      );
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(marker);
    }
  } finally {
    await server.close();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
    await rm(custom, { recursive: true, force: true });
  }
});
