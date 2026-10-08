import type { Pool } from 'pg';
import type { Response } from 'supertest';

/** Test fixture recovery only: never retry permissions, validation, arbitrary conflicts or 5xx. */
export async function retryClinicalClock(
  pool: Pool,
  operation: () => Promise<Response>,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await operation();
    if (
      attempt === 3 ||
      response.status !== 409 ||
      response.body.error?.code !== 'CLINICAL_CLOCK_CONFLICT'
    )
      return response;
    // Real PostgreSQL wall-clock recovery, not invented event times or changed clinical rules.
    await pool.query('SELECT pg_sleep(2)');
  }
}
