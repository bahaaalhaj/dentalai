import { randomUUID } from 'node:crypto';
import { createDatabase, migrateDatabase, schema, withTransaction } from '@dentalai/database';
import { ReadinessResponseSchema } from '@dentalai/contracts';
import { count, eq } from 'drizzle-orm';
import pino from 'pino';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '../../src/app.js';
import { AuditEventWriter } from '../../src/domains/audit/audit-event.writer.js';
import { PostgresSystemRepository } from '../../src/domains/system/system.repository.js';
import { SystemService } from '../../src/domains/system/system.service.js';
import { ApplicationLifecycle } from '../../src/infrastructure/lifecycle.js';

const adminUrl = process.env['DATABASE_URL'];
if (!adminUrl) {
  throw new Error(
    'DATABASE_URL is required for API integration tests. Point it at a disposable PostgreSQL instance.',
  );
}

const databaseName = `dentalai_api_test_${randomUUID().replaceAll('-', '')}`;
const testUrl = new URL(adminUrl);
testUrl.pathname = `/${databaseName}`;
const adminPool = new Pool({ connectionString: adminUrl, max: 1 });
const database = createDatabase(testUrl.toString());
const clinicId = randomUUID();
const logger = pino({ level: 'silent' });
let databasePoolEnded = false;

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${databaseName}"`);
  await migrateDatabase(testUrl.toString());
  await database.db.insert(schema.clinics).values({
    id: clinicId,
    legalName: 'API Integration Test Clinic',
    displayName: 'API Integration Test Clinic',
    slug: `api-integration-${clinicId.slice(0, 8)}`,
    defaultTimezone: 'Etc/UTC',
    defaultCurrency: 'USD',
  });
});

afterAll(async () => {
  if (!databasePoolEnded) await database.pool.end();
  await adminPool.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [databaseName],
  );
  await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await adminPool.end();
});

describe('API PostgreSQL integration', () => {
  it('proves database connectivity through the readiness repository', async () => {
    const repository = new PostgresSystemRepository(database.pool);
    await expect(repository.ping()).resolves.toBeUndefined();
  });

  it('rolls back audit writes with their surrounding transaction', async () => {
    const writer = new AuditEventWriter();
    await expect(
      withTransaction(database.db, async (transaction) => {
        await writer.write(transaction, {
          clinicId,
          action: 'integration.rollback',
          entityType: 'integration_test',
          data: { expected: 'rollback' },
        });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    const [result] = await database.db
      .select({ value: count() })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, 'integration.rollback'));
    expect(result?.value).toBe(0);
  });

  it('writes committed append-only audit events', async () => {
    const writer = new AuditEventWriter();
    const event = await withTransaction(database.db, (transaction) =>
      writer.write(transaction, {
        clinicId,
        action: 'integration.committed',
        entityType: 'integration_test',
        requestId: 'integration-request',
        data: { expected: 'commit' },
      }),
    );

    expect(event.clinicId).toBe(clinicId);
    const [result] = await database.db
      .select({ value: count() })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.id, event.id));
    expect(result?.value).toBe(1);
  });

  it('returns a safe readiness response after a real database failure', async () => {
    const application = await createApplication({
      logger,
      systemService: new SystemService(
        new PostgresSystemRepository(database.pool),
        new ApplicationLifecycle(),
      ),
      options: {
        bodyLimit: '100kb',
        corsOrigins: [],
        trustProxy: false,
        rateLimitWindowMs: 60_000,
        rateLimitMax: 100,
      },
    });

    await request(application).get('/api/v1/health/ready').expect(200);
    await database.pool.end();
    databasePoolEnded = true;

    const failed = await request(application).get('/api/v1/health/ready').expect(503);
    const body = ReadinessResponseSchema.parse(failed.body);
    expect(body.checks.database).toBe('error');
    expect(JSON.stringify(body)).not.toContain('pool');
    expect(JSON.stringify(body)).not.toContain('ended');
  });
});
