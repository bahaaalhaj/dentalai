import { describe, expect, it } from 'vitest';
import { EnvironmentConfigurationError, readEnvironment } from '../../src/config/environment.js';

const required = {
  DATABASE_URL: 'postgresql://api:local-only@localhost:5432/dentalai',
};

describe('API environment validation', () => {
  it('does not echo credentials embedded in an invalid origin', () => {
    let message = '';
    try {
      readEnvironment({
        ...required,
        CORS_ORIGINS: 'https://user:never-log-this-password@example.test',
      });
    } catch (error) {
      message = error instanceof Error ? error.message : 'Unknown error';
    }
    expect(message).toContain('Invalid CORS origin');
    expect(message).not.toContain('never-log-this-password');
  });
  it('applies secure defaults', () => {
    const environment = readEnvironment({
      ...required,
      PORT: '',
      LOG_LEVEL: '',
      OUTBOX_WORKER_ENABLED: '',
    });

    expect(environment.port).toBe(3000);
    expect(environment.corsOrigins).toEqual([]);
    expect(environment.outboxWorkerEnabled).toBe(false);
    expect(environment.bodyLimit).toBe('100kb');
  });

  it('rejects missing database configuration and wildcard CORS', () => {
    expect(() => readEnvironment({})).toThrow(EnvironmentConfigurationError);
    expect(() => readEnvironment({ ...required, CORS_ORIGINS: '*' })).toThrow(
      EnvironmentConfigurationError,
    );
  });
  it('rejects weak secrets, non-origin callback configuration, and invalid SMTP protocols', () => {
    for (const extra of [
      { AUTH_SECRET: 'short' },
      { APP_ORIGIN: 'https://dentalai.test/path' },
      { SMTP_URL: 'https://mail.test' },
    ])
      expect(() => readEnvironment({ ...required, ...extra })).toThrow(
        EnvironmentConfigurationError,
      );
    expect(
      readEnvironment({ ...required, AUTH_SECRET: '', SMTP_URL: '', MAIL_FROM: '' }).authSecret,
    ).toBeUndefined();
  });
});
