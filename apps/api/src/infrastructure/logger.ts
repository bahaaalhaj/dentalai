import pino, { type Logger } from 'pino';

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'dentalai-api' },
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
  });
}
