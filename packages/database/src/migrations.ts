import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
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
