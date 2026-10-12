import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigurationError';
  }
}

export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const databaseUrl = env['DATABASE_URL']?.trim();
  if (!databaseUrl) {
    throw new DatabaseConfigurationError(
      'DATABASE_URL is required by the server-side PostgreSQL data layer.',
    );
  }
  return databaseUrl;
}

export function createDatabase(connectionString = requireDatabaseUrl()) {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
    statement_timeout: 15000,
    max: 20,
  });
  return { pool, db: drizzle(pool, { schema }) };
}
