import type { Pool } from 'pg';

export interface SystemRepositoryPort {
  ping(): Promise<void>;
}

export class PostgresSystemRepository implements SystemRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}
