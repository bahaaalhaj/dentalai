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
import { OutboxWorker } from '../../src/workers/outbox.worker.js';

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
  it('reclaims expired outbox leases, but never steals a live lease', async () => {
    const oldJob = randomUUID();
    const liveJob = randomUUID();
    await database.pool.query(
      `INSERT INTO outbox_jobs(id,clinic_id,topic,aggregate_type,status,locked_at,locked_by,attempts,idempotency_key,payload)
       VALUES($1::uuid,$3,'review.test','review','processing',now()-interval '10 minutes','crashed',1,$1::uuid::text,'{}'),
             ($2::uuid,$3,'review.test','review','processing',now(),'live',1,$2::uuid::text,'{}')`,
      [oldJob, liveJob, clinicId],
    );
    const handled: string[] = [];
    const worker = new OutboxWorker(
      database.pool,
      logger,
      new Map([
        [
          'review.test',
          async (job) => {
            handled.push(job.id);
          },
        ],
      ]),
      { pollIntervalMs: 1000 },
    );
    await worker.runOnce();
    await worker.runOnce();
    expect(handled).toEqual([oldJob]);
    const jobs = await database.pool.query<{ id: string; status: string; attempts: number }>(
      'SELECT id,status,attempts FROM outbox_jobs WHERE id=ANY($1::uuid[])',
      [[oldJob, liveJob]],
    );
    expect(jobs.rows.find((job) => job.id === oldJob)).toMatchObject({
      status: 'completed',
      attempts: 2,
    });
    expect(jobs.rows.find((job) => job.id === liveJob)).toMatchObject({
      status: 'processing',
      attempts: 1,
    });
  });
  it('lets only one concurrent worker claim a ready outbox job', async () => {
    const jobId = randomUUID();
    await database.pool.query(
      "INSERT INTO outbox_jobs(id,clinic_id,topic,aggregate_type,payload,idempotency_key) VALUES($1::uuid,$2,'review.concurrent','review','{}',$1::uuid::text)",
      [jobId, clinicId],
    );
    const handled: string[] = [];
    const handlers = new Map([
      [
        'review.concurrent',
        async (job: { id: string }) => {
          handled.push(job.id);
        },
      ],
    ]);
    await Promise.all([
      new OutboxWorker(database.pool, logger, handlers, { pollIntervalMs: 100_000 }).runOnce(),
      new OutboxWorker(database.pool, logger, handlers, { pollIntervalMs: 100_000 }).runOnce(),
    ]);
    expect(handled).toEqual([jobId]);
    expect(
      (await database.pool.query('SELECT status,attempts FROM outbox_jobs WHERE id=$1', [jobId]))
        .rows[0],
    ).toEqual({ status: 'completed', attempts: 1 });
  });
  it('does not let a stale worker acknowledge a reclaimed and failed attempt', async () => {
    const jobId = randomUUID();
    await database.pool.query(
      "INSERT INTO outbox_jobs(id,clinic_id,topic,aggregate_type,payload,idempotency_key) VALUES($1::uuid,$2,'review.stale','review','{}',$1::uuid::text)",
      [jobId, clinicId],
    );
    const second = new OutboxWorker(
      database.pool,
      logger,
      new Map([
        [
          'review.stale',
          async () => {
            throw new Error('fictional second-attempt failure');
          },
        ],
      ]),
      { workerId: 'same-identity-for-regression', pollIntervalMs: 100_000 },
    );
    const first = new OutboxWorker(
      database.pool,
      logger,
      new Map([
        [
          'review.stale',
          async () => {
            await database.pool.query(
              "UPDATE outbox_jobs SET locked_at=now()-interval '10 minutes' WHERE id=$1",
              [jobId],
            );
            await second.runOnce();
          },
        ],
      ]),
      { workerId: 'same-identity-for-regression', pollIntervalMs: 100_000 },
    );
    await first.runOnce();
    expect(
      (await database.pool.query('SELECT status,attempts FROM outbox_jobs WHERE id=$1', [jobId]))
        .rows[0],
    ).toEqual({ status: 'failed', attempts: 2 });
  });
  it('does not persist or log secret or patient content from an outbox handler error', async () => {
    const jobId = randomUUID();
    const sensitive = 'fictional-patient-token-and-password-marker';
    await database.pool.query(
      "INSERT INTO outbox_jobs(id,clinic_id,topic,aggregate_type,payload,idempotency_key) VALUES($1::uuid,$2,'review.failure','review',jsonb_build_object('sensitive',$3::text),$1::uuid::text)",
      [jobId, clinicId, sensitive],
    );
    const logs: string[] = [];
    const worker = new OutboxWorker(
      database.pool,
      pino(
        { level: 'info' },
        {
          write: (message) => {
            logs.push(message);
          },
        },
      ),
      new Map([
        [
          'review.failure',
          async () => {
            throw new Error(sensitive);
          },
        ],
      ]),
      { pollIntervalMs: 1000 },
    );
    await worker.runOnce();
    const row = (
      await database.pool.query<{ status: string; last_error: string }>(
        'SELECT status,last_error FROM outbox_jobs WHERE id=$1',
        [jobId],
      )
    ).rows[0];
    expect(row).toEqual({ status: 'failed', last_error: 'HANDLER_FAILED' });
    expect(logs.join('')).not.toContain(sensitive);
    expect(logs.join('')).toContain('Outbox handler failed');
  });
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
