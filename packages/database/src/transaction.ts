import type { createDatabase } from './client.js';

export type DentalDatabase = ReturnType<typeof createDatabase>['db'];
export type DentalTransaction = Parameters<Parameters<DentalDatabase['transaction']>[0]>[0];

export async function withTransaction<T>(
  database: DentalDatabase,
  operation: (transaction: DentalTransaction) => Promise<T>,
): Promise<T> {
  return database.transaction(operation);
}
