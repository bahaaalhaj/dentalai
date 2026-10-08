import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { localMailSender } from '../../src/domains/auth/local-mail.js';
import { readEnvironment } from '../../src/config/environment.js';

describe('explicit private development mailbox', () => {
  it('captures real mail privately without a network service and rejects unsafe directories', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dentalai-mail-'));
    try {
      const message = {
        to: 'synthetic@example.invalid',
        subject: 'Development verification',
        text: 'Synthetic test token, not a real credential',
      };
      await localMailSender(directory)(message);
      const files = await readdir(directory);
      expect(files).toHaveLength(1);
      expect(JSON.parse(await readFile(path.join(directory, files[0]!), 'utf8'))).toEqual(message);
      expect(() => localMailSender(path.parse(directory).root)).toThrow();
      expect(() => localMailSender(path.join(directory, 'public'))).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('cannot silently replace SMTP or operate in production', () => {
    const DATABASE_URL = 'postgresql://localhost/demo';
    expect(readEnvironment({ DATABASE_URL }).mailDriver).toBe('smtp');
    expect(() => readEnvironment({ DATABASE_URL, MAIL_DRIVER: 'filesystem' })).toThrow();
    expect(() =>
      readEnvironment({
        DATABASE_URL,
        MAIL_DRIVER: 'filesystem',
        PRIVATE_MAIL_DIRECTORY: os.tmpdir(),
        NODE_ENV: 'production',
      }),
    ).toThrow();
  });
});
