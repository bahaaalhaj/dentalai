import pino, { type Logger, type DestinationStream } from 'pino';

/** Allowlisted operational metadata. No arbitrary objects, error stacks or payloads. */
export function safeLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of ['statusCode', 'durationMs', 'attempt', 'port']) {
    if (typeof fields[key] === 'number' && Number.isFinite(fields[key])) safe[key] = fields[key];
  }
  for (const key of ['code', 'apiVersion', 'signal', 'operation']) {
    const value = fields[key];
    if (typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,80}$/.test(value)) safe[key] = value;
  }
  for (const key of ['traceId', 'spanId', 'outboxJobId']) {
    const value = fields[key];
    if (typeof value === 'string' && /^[a-f0-9-]{16,36}$/.test(value)) safe[key] = value;
  }
  return safe;
}

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: { service: 'dentalai-api' },
      formatters: { log: safeLogFields, bindings: () => ({ service: 'dentalai-api' }) },
      // Pino intentionally resets the bindings formatter for child loggers. Scrub again
      // at the final serialization boundary so pino-http/child bindings cannot bypass it.
      hooks: {
        streamWrite(line) {
          try {
            const fields: Record<string, unknown> = JSON.parse(line);
            return (
              JSON.stringify({
                level: fields['level'],
                time: fields['time'],
                service: 'dentalai-api',
                ...safeLogFields(fields),
                msg: fields['msg'],
              }) + '\n'
            );
          } catch {
            return (
              JSON.stringify({
                level: 50,
                service: 'dentalai-api',
                code: 'LOG_SERIALIZATION_FAILED',
                msg: 'Operational log serialization failed',
              }) + '\n'
            );
          }
        },
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'request.headers.authorization',
          'request.headers.cookie',
          '*.password',
          '*.passwordHash',
          '*.token',
          '*.tokenHash',
        ],
        censor: '[REDACTED]',
      },
    },
    destination,
  );
}
