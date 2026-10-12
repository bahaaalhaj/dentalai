import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from 'pino';

// Bounded dimensions only: never user IDs, tenant IDs, URLs, queries or payloads.
export function operationGroup(path: string): string {
  const segment = path.split('/')[3];
  return [
    'auth',
    'access',
    'admin',
    'scheduling',
    'appointments',
    'clinical',
    'billing',
    'imaging',
    'anesthesia',
    'health',
    'contracts',
  ].includes(segment ?? '')
    ? segment!
    : 'other';
}

export class ApplicationTelemetry {
  private readonly counters = new Map<
    string,
    { requests: number; errors: number; totalMs: number; buckets: number[] }
  >();
  readonly middleware: RequestHandler = (request, response, next) => {
    const started = performance.now();
    const operation = operationGroup(request.path);
    const traceId = randomBytes(16).toString('hex');
    const spanId = randomBytes(8).toString('hex');
    response.setHeader('x-trace-id', traceId);
    response.once('finish', () => {
      const durationMs = performance.now() - started;
      const key = `${operation}:${response.statusCode >= 500 ? '5xx' : response.statusCode >= 400 ? '4xx' : 'success'}`;
      const entry = this.counters.get(key) ?? {
        requests: 0,
        errors: 0,
        totalMs: 0,
        buckets: [0, 0, 0, 0, 0, 0],
      };
      entry.requests++;
      entry.errors += response.statusCode >= 500 ? 1 : 0;
      entry.totalMs += durationMs;
      [50, 100, 250, 1000, 5000, Infinity].forEach((bound, index) => {
        if (durationMs <= bound) entry.buckets[index] = entry.buckets[index]! + 1;
      });
      this.counters.set(key, entry);
      this.logger.info(
        {
          operation,
          traceId,
          spanId,
          durationMs: Math.round(durationMs),
          statusCode: response.statusCode,
        },
        'HTTP span completed',
      );
    });
    next();
  };
  constructor(private readonly logger: Logger) {}
  snapshot() {
    return {
      service: 'dentalai-api',
      uptimeSeconds: Math.floor(process.uptime()),
      memoryBytes: process.memoryUsage().rss,
      http: Object.fromEntries(this.counters),
    };
  }
}

export function monitoringAuthorization(token: string): RequestHandler {
  const expected = Buffer.from(`Bearer ${token}`);
  return (request, response, next) => {
    const candidate = Buffer.from(request.header('authorization') ?? '');
    response.setHeader('cache-control', 'no-store');
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      response.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    next();
  };
}
