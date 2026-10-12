import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '@dentalai/database';
import { z } from 'zod';
import { readEnvironment } from '../../config/environment.js';
import { AdministrationRepository } from './administration.repository.js';
try {
  loadEnvFile(fileURLToPath(new URL('../../../../../.env', import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const [clinic, plan, action, reason, ack] = process.argv.slice(2);
if (ack !== '--ack-no-payment')
  throw new Error(
    'Usage: npm run subscription:admin -- <clinic UUID> <starter|team> <activate|past_due|suspend|cancel> <reason> --ack-no-payment. Administrative grant only; no payment processed.',
  );
const input = z
  .object({
    clinic: z.uuid(),
    plan: z.enum(['starter', 'team']),
    action: z.enum(['activate', 'past_due', 'suspend', 'cancel']),
    reason: z.string().trim().min(3).max(500),
  })
  .parse({ clinic, plan, action, reason });
const env = readEnvironment();
if (!env.authSecret) throw new Error('Server AUTH_SECRET required');
const { pool } = createDatabase(env.databaseUrl);
try {
  const repository = new AdministrationRepository(pool, {
    secret: env.authSecret,
    origin: env.appOrigin,
    sendMail: async () => {
      throw new Error('No notification delivery from administrative CLI');
    },
  });
  await repository.administrativeGrant(input.clinic, input.plan, input.action, input.reason);
  console.log(
    'Administrative subscription state changed and audited. No payment was attempted or recorded.',
  );
} finally {
  await pool.end();
}
