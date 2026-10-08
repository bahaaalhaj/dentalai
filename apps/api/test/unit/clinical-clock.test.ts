import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { retryClinicalClock } from '../support/clinical-clock.js';
afterEach(() => vi.restoreAllMocks());
function fixture(status: number, code: string, recoverAt = Infinity) {
  const pool = new Pool();
  // Lazy pool never connects: exercise only the test fixture's bounded waiting contract.
  const wait = vi.spyOn(pool, 'query').mockImplementation(async () => ({ rows: [] }));
  const app = express();
  let attempts = 0;
  app.post('/fixture', (_req, res) => {
    attempts++;
    res.status(attempts >= recoverAt ? 200 : status).json({ error: { code } });
  });
  const operation = vi.fn(async () => await request(app).post('/fixture'));
  return { pool, wait, operation };
}
describe('test-only clinical clock recovery', () => {
  it('retries only the explicit rolled-back clock error and eventually returns success', async () => {
    const f = fixture(409, 'CLINICAL_CLOCK_CONFLICT', 3);
    expect((await retryClinicalClock(f.pool, f.operation)).status).toBe(200);
    expect(f.operation).toHaveBeenCalledTimes(3);
    expect(f.wait).toHaveBeenCalledTimes(2);
    expect(f.wait).toHaveBeenCalledWith('SELECT pg_sleep(2)');
  });
  it.each([
    [403, 'ACCESS_DENIED'],
    [409, 'CLINICAL_CONFLICT'],
    [503, 'DEPENDENCY_UNAVAILABLE'],
  ] as const)('does not hide %s %s', async (status, code) => {
    const f = fixture(status, code);
    expect((await retryClinicalClock(f.pool, f.operation)).status).toBe(status);
    expect(f.operation).toHaveBeenCalledTimes(1);
    expect(f.wait).not.toHaveBeenCalled();
  });
  it('returns a persistent clock failure after four attempts, never fabricated success', async () => {
    const f = fixture(409, 'CLINICAL_CLOCK_CONFLICT');
    expect((await retryClinicalClock(f.pool, f.operation)).status).toBe(409);
    expect(f.operation).toHaveBeenCalledTimes(4);
    expect(f.wait).toHaveBeenCalledTimes(3);
  });
});
