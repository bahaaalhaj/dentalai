import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { readEnvironment } from '../../src/config/environment.js';
import { resolveSecretFiles } from '../../src/config/secrets.js';
import { createLogger } from '../../src/infrastructure/logger.js';
import {
  ApplicationTelemetry,
  monitoringAuthorization,
} from '../../src/infrastructure/observability.js';
import { SystemService } from '../../src/domains/system/system.service.js';
import { ApplicationLifecycle } from '../../src/infrastructure/lifecycle.js';

const hardened = () => ({
  MONITORING_TOKEN: randomBytes(32).toString('hex'),
  NODE_ENV: 'production',
  DEPLOYMENT_ENV: 'staging',
  DATABASE_URL: `postgresql://dentalai_app:${randomBytes(24).toString('hex')}@db/dentalai`,
  AUTH_SECRET: randomBytes(32).toString('hex'),
  APP_ORIGIN: 'https://clinic.example.test',
  SMTP_URL: 'smtps://mail.example.test',
  MAIL_FROM: 'clinic@example.test',
  OUTBOX_WORKER_ENABLED: 'true',
});
describe('production hardening', () => {
  it('separates environments and rejects insecure staging/production configuration', () => {
    expect(readEnvironment(hardened()).deploymentEnv).toBe('staging');
    for (const extra of [
      { NODE_ENV: 'development' },
      { AUTH_SECRET: 'development-secret-'.repeat(3) },
      { APP_ORIGIN: 'http://clinic.example.test' },
      { MAIL_DRIVER: 'filesystem' },
      { LOG_LEVEL: 'debug' },
      { CORS_ORIGINS: 'http://other.example.test' },
      { OUTBOX_WORKER_ENABLED: 'false' },
      { DATABASE_URL: 'postgresql://postgres:short@db/dentalai' },
    ])
      expect(() => readEnvironment({ ...hardened(), ...extra })).toThrow();
    expect(
      readEnvironment({
        NODE_ENV: 'test',
        DEPLOYMENT_ENV: 'test',
        DATABASE_URL: 'postgresql://test:test@localhost/test',
      }).deploymentEnv,
    ).toBe('test');
  });
  it('loads mounted secrets and rejects ambiguous or malformed mounts without echoing data', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dentalai-secret-test-'));
    try {
      const file = path.join(directory, 'secret');
      const value = randomBytes(32).toString('hex');
      await writeFile(file, value, { mode: 0o600 });
      expect(resolveSecretFiles({ AUTH_SECRET_FILE: file }).AUTH_SECRET).toBe(value);
      expect(() => resolveSecretFiles({ AUTH_SECRET: value, AUTH_SECRET_FILE: file })).toThrow(
        'not both',
      );
      await writeFile(file, 'never-log-this\nsecond-line');
      expect(() => resolveSecretFiles({ AUTH_SECRET_FILE: file })).toThrow(
        'Cannot read a valid AUTH_SECRET_FILE',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('allows only operational log metadata; metrics/traces do not contain clinical IDs or tokens', async () => {
    const lines: string[] = [];
    const logger = createLogger('info', {
      write: (line) => {
        lines.push(line);
      },
    });
    logger
      .child({ patientId: 'secret-patient', session_token: 'secret-token' })
      .info('Safe child event');
    logger.info(
      {
        password: 'secret-password',
        token: 'secret-token',
        patientId: 'secret-patient',
        req: { url: '/patient/secret-patient', body: { image: 'secret-image' } },
        err: new Error('secret-password'),
        statusCode: 500,
      },
      'Safe test event',
    );
    const telemetry = new ApplicationTelemetry(logger);
    const app = express();
    app.use(telemetry.middleware);
    app.get('/api/v1/clinical/:id', (_req, res) => res.sendStatus(503));
    await request(app).get('/api/v1/clinical/secret-patient?token=secret-token').expect(503);
    const output = lines.join('') + JSON.stringify(telemetry.snapshot());
    for (const value of ['secret-password', 'secret-token', 'secret-patient', 'secret-image'])
      expect(output).not.toContain(value);
    expect(output).toContain('traceId');
    expect(output).toContain('clinical:5xx');
    expect(telemetry.snapshot().http['clinical:5xx']?.errors).toBe(1);
  });
  it('protects the monitoring endpoint and degrades dependency readiness without leaking errors', async () => {
    const app = express();
    app.use(monitoringAuthorization('a'.repeat(32)));
    app.get('/metrics', (_req, res) => res.json({ ok: true }));
    await request(app).get('/metrics').expect(401);
    await request(app)
      .get('/metrics')
      .set('authorization', `Bearer ${'a'.repeat(32)}`)
      .expect(200);
    const service = new SystemService({ ping: async () => {} }, new ApplicationLifecycle(), {
      storage: async () => {
        throw new Error('password=private');
      },
      ai: 'disabled',
      worker: async () => {},
    });
    const result = await service.readiness();
    expect(result.status).toBe('not_ready');
    expect(result.checks.dependencies).toEqual({ storage: 'error', ai: 'disabled', worker: 'ok' });
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
