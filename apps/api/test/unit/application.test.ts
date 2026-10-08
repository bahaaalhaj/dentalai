import {
  ApiErrorResponseSchema,
  LivenessResponseSchema,
  OpenApiDocumentSchema,
  ReadinessResponseSchema,
} from '@dentalai/contracts';
import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApplication } from '../../src/app.js';
import { SystemService } from '../../src/domains/system/system.service.js';
import { ApplicationLifecycle } from '../../src/infrastructure/lifecycle.js';
import { getValidated, sendValidated, validateRequest } from '../../src/middleware/validation.js';

const logger = pino({ level: 'silent' });

async function testApplication(repository: { ping(): Promise<void> }) {
  return createApplication({
    logger,
    systemService: new SystemService(repository, new ApplicationLifecycle()),
    options: {
      bodyLimit: '1kb',
      corsOrigins: [],
      trustProxy: false,
      rateLimitWindowMs: 60_000,
      rateLimitMax: 1_000,
    },
  });
}

describe('versioned API foundation', () => {
  it('serves validated liveness and generated OpenAPI contracts with request IDs', async () => {
    const application = await testApplication({ ping: async () => undefined });
    const live = await request(application)
      .get('/api/v1/health/live')
      .set('x-request-id', 'safe-request-id')
      .expect(200);
    const contract = await request(application)
      .get('/api/v1/contracts/v1?format=openapi')
      .expect(200);

    expect(live.headers['x-request-id']).toBe('safe-request-id');
    expect(live.headers['x-content-type-options']).toBe('nosniff');
    expect(LivenessResponseSchema.parse(live.body).version).toBe('v1');
    expect(OpenApiDocumentSchema.parse(contract.body).paths).toHaveProperty('/api/v1/health/ready');
  });

  it('rejects malformed parameters and query strings with safe validation details', async () => {
    const application = await testApplication({ ping: async () => undefined });
    const response = await request(application)
      .get('/api/v1/contracts/v2?unexpected=true')
      .expect(400);
    const body = ApiErrorResponseSchema.parse(response.body);

    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(body.error.details?.map(({ path }) => path)).toEqual(
      expect.arrayContaining(['params.version', 'query']),
    );
  });

  it('returns a non-leaking readiness response when PostgreSQL fails', async () => {
    const application = await testApplication({
      ping: async () => {
        throw new Error('password=do-not-leak host=internal-db');
      },
    });
    const response = await request(application).get('/api/v1/health/ready').expect(503);
    const body = ReadinessResponseSchema.parse(response.body);

    expect(body.status).toBe('not_ready');
    expect(body.checks.database).toBe('error');
    expect(JSON.stringify(body)).not.toContain('do-not-leak');
    expect(JSON.stringify(body)).not.toContain('internal-db');
  });

  it('denies unconfigured cross-origin requests', async () => {
    const application = await testApplication({ ping: async () => undefined });
    const response = await request(application)
      .get('/api/v1/health/live')
      .set('origin', 'https://untrusted.example')
      .expect(403);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(ApiErrorResponseSchema.parse(response.body).error.code).toBe('CORS_ORIGIN_DENIED');
  });

  it('returns contract-safe rate-limit failures', async () => {
    const application = await createApplication({
      logger,
      systemService: new SystemService({ ping: async () => undefined }, new ApplicationLifecycle()),
      options: {
        bodyLimit: '1kb',
        corsOrigins: [],
        trustProxy: false,
        rateLimitWindowMs: 60_000,
        rateLimitMax: 1,
      },
    });

    await request(application).get('/api/v1/health/live').expect(200);
    const limited = await request(application).get('/api/v1/health/live').expect(429);
    expect(ApiErrorResponseSchema.parse(limited.body).error.code).toBe('RATE_LIMITED');
    expect(limited.headers['ratelimit']).toBeDefined();
  });

  it('handles malformed and oversized JSON centrally', async () => {
    const application = await testApplication({ ping: async () => undefined });
    const malformed = await request(application)
      .post('/api/v1/not-implemented')
      .set('content-type', 'application/json')
      .send('{')
      .expect(400);
    const oversized = await request(application)
      .post('/api/v1/not-implemented')
      .send({ value: 'x'.repeat(2_000) })
      .expect(413);

    expect(ApiErrorResponseSchema.parse(malformed.body).error.code).toBe('MALFORMED_JSON');
    expect(ApiErrorResponseSchema.parse(oversized.body).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('validates bodies and responses through the shared middleware', async () => {
    const BodySchema = z.object({ value: z.string().min(1) }).strict();
    const ResponseSchema = z.object({ accepted: z.literal(true) });
    const application = await createApplication({
      logger,
      systemService: new SystemService({ ping: async () => undefined }, new ApplicationLifecycle()),
      options: {
        bodyLimit: '1kb',
        corsOrigins: [],
        trustProxy: false,
        rateLimitWindowMs: 60_000,
        rateLimitMax: 1_000,
      },
      mountFrontend(app: express.Express) {
        app.post('/test/body', validateRequest({ body: BodySchema }), (_request, response) => {
          getValidated<z.infer<typeof BodySchema>>(response, 'body');
          sendValidated(response, ResponseSchema, { accepted: true });
        });
        app.get('/test/bad-response', (_request, response) => {
          sendValidated(response, ResponseSchema, { accepted: false });
        });
      },
    });

    await request(application).post('/test/body').send({ value: '' }).expect(400);
    await request(application).post('/test/body').send({ value: 'valid' }).expect(200, {
      accepted: true,
    });
    const invalidResponse = await request(application).get('/test/bad-response').expect(500);
    expect(ApiErrorResponseSchema.parse(invalidResponse.body).error.code).toBe('INTERNAL_ERROR');
  });
});
