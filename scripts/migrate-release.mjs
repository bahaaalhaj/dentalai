import { readFileSync } from 'node:fs';
import { migrateDatabase } from '@dentalai/database';
if (process.env.MIGRATION_BACKUP_VERIFIED !== 'true')
  throw new Error(
    'Migration requires an operator-verified backup and MIGRATION_BACKUP_VERIFIED=true.',
  );
const file = process.env.DATABASE_URL_FILE;
if (!file) throw new Error('A private migration database secret mount is required.');
try {
  await migrateDatabase(readFileSync(file, 'utf8').trim());
  console.log('Reviewed migrations applied; history checks passed.');
} catch {
  console.error('Migration failed. Preserve the backup and stop incompatible writers.');
  process.exitCode = 1;
}
