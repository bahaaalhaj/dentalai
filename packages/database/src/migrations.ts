import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { Pool } from 'pg';

export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
export const developmentSeedFile = fileURLToPath(
  new URL('../seed/development.sql', import.meta.url),
);

export async function migrateDatabase(
  connectionString: string,
  folder = migrationsFolder,
): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    // Serialize runners on this single connection before checking or applying migration history.
    await pool.query("SELECT pg_advisory_lock(hashtextextended('dentalai:migrations',0))");
    const files = readMigrationFiles({ migrationsFolder: folder });
    const historyExists = await pool.query<{ present: boolean }>(
      "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present",
    );
    if (historyExists.rows[0]?.present) {
      const applied = await pool.query<{ hash: string; created_at: string }>(
        'SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id',
      );
      for (const [index, row] of applied.rows.entries()) {
        const file = files[index];
        const sql = file?.sql.join('--> statement-breakpoint').replaceAll('\r\n', '\n');
        // Drizzle hashes bytes. Accept ONLY equivalent LF/CRLF checkouts, not changed SQL.
        const hashes =
          sql === undefined
            ? []
            : [sql, sql.replaceAll('\n', '\r\n')].map((value) =>
                createHash('sha256').update(value).digest('hex'),
              );
        if (!file || Number(row.created_at) !== file.folderMillis || !hashes.includes(row.hash)) {
          throw new Error(
            'Migration history differs from reviewed SQL. Stop deployment and reconcile against a verified backup; do not rewrite migration history.',
          );
        }
      }
    }
    await migrate(drizzle(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}

export async function seedDevelopmentDatabase(
  connectionString: string,
  seedFile = developmentSeedFile,
): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const sql = await readFile(seedFile, 'utf8');
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}
