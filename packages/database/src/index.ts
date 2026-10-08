export { createDatabase, DatabaseConfigurationError, requireDatabaseUrl } from './client.js';
export { migrateDatabase, seedDevelopmentDatabase } from './migrations.js';
export { withTransaction } from './transaction.js';
export type { DentalDatabase, DentalTransaction } from './transaction.js';
export * as schema from './schema/index.js';
