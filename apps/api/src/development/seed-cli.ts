import { loadEnvFile } from 'node:process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateDatabase } from '@dentalai/database';
import {
  assertLocalDevelopmentDatabase,
  seedLocalDevelopment,
  developmentAccounts,
} from './seed.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
try {
  loadEnvFile(path.join(root, '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const url = process.env['DATABASE_URL'];
if (!url) throw new Error('Set DATABASE_URL for a dedicated local development database.');
const nodeEnv = process.env['NODE_ENV'] ?? 'development';
assertLocalDevelopmentDatabase(url, nodeEnv);
const local = path.join(root, '.local');
const credentialFile = path.join(local, 'development-credentials.json');
let password = process.env['DENTALAI_DEVELOPMENT_PASSWORD'];
if (!password) {
  try {
    const data: unknown = JSON.parse(await readFile(credentialFile, 'utf8'));
    if (
      typeof data === 'object' &&
      data !== null &&
      'password' in data &&
      typeof data.password === 'string'
    )
      password = data.password;
    else throw new Error('Invalid local credential file; nothing was overwritten.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    password = randomBytes(32).toString('base64url');
    await mkdir(local, { recursive: true, mode: 0o700 });
    await writeFile(
      credentialFile,
      JSON.stringify(
        { localOnly: true, password, emails: developmentAccounts.map((a) => a.email) },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
  }
}
await migrateDatabase(url);
await seedLocalDevelopment(url, password, nodeEnv);
console.log('Synthetic local fixtures seeded idempotently. No legacy data was imported.');
console.log(
  'Local-only credentials are in .local/development-credentials.json (or your explicitly supplied environment). Never commit or deploy them.',
);
