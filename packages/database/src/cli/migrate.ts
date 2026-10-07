import { migrateDatabase } from '../migrations.js';
import { requireDatabaseUrl } from '../client.js';

await migrateDatabase(requireDatabaseUrl());
console.log('DentalAI PostgreSQL migrations applied successfully.');
