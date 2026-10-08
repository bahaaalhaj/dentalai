import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env['DATABASE_URL'];

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: databaseUrl
    ? { url: databaseUrl }
    : { url: 'postgresql://configuration-required' },
  strict: true,
  verbose: true,
});
