import { z } from 'zod';

const emptyToUndefined = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema,
  );

const booleanString = emptyToUndefined(
  z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
);

const EnvironmentSchema = z
  .object({
    NODE_ENV: emptyToUndefined(
      z.enum(['development', 'test', 'production']).default('development'),
    ),
    HOST: emptyToUndefined(z.string().min(1).default('0.0.0.0')),
    PORT: emptyToUndefined(z.coerce.number().int().min(1).max(65_535).default(3000)),
    DATABASE_URL: z
      .url()
      .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol), {
        message: 'DATABASE_URL must use the postgres or postgresql protocol',
      }),
    LOG_LEVEL: emptyToUndefined(
      z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    ),
    BODY_LIMIT: emptyToUndefined(
      z
        .string()
        .regex(/^\d+(?:b|kb|mb)$/i)
        .default('100kb'),
    ),
    CORS_ORIGINS: z.string().default(''),
    TRUST_PROXY: booleanString,
    RATE_LIMIT_WINDOW_MS: emptyToUndefined(z.coerce.number().int().min(1_000).default(60_000)),
    RATE_LIMIT_MAX: emptyToUndefined(z.coerce.number().int().min(1).default(120)),
    SHUTDOWN_TIMEOUT_MS: emptyToUndefined(z.coerce.number().int().min(1_000).default(10_000)),
    OUTBOX_WORKER_ENABLED: booleanString,
    CLINICAL_STORAGE_ENABLED: booleanString,
    STORAGE_DRIVER: emptyToUndefined(z.enum(['s3', 'filesystem']).default('s3')),
    PRIVATE_STORAGE_DIRECTORY: emptyToUndefined(z.string().min(1).optional()),
    XRAY_INFERENCE_ENABLED: booleanString,
    S3_ENDPOINT: emptyToUndefined(z.url().optional()),
    S3_BUCKET: emptyToUndefined(z.string().min(3).optional()),
    S3_ACCESS_KEY: emptyToUndefined(z.string().min(1).optional()),
    S3_SECRET_KEY: emptyToUndefined(z.string().min(16).optional()),
    AI_SERVICE_URL: emptyToUndefined(z.url().optional()),
    AI_SERVICE_TOKEN: emptyToUndefined(z.string().min(32).optional()),
    AUTH_SECRET: emptyToUndefined(z.string().min(32).optional()),
    APP_ORIGIN: emptyToUndefined(
      z
        .url()
        .refine((value) => {
          const parsed = new URL(value);
          return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === value;
        }, 'APP_ORIGIN must be an HTTP(S) origin without a path')
        .default('http://localhost:3000'),
    ),
    SMTP_URL: emptyToUndefined(
      z
        .url()
        .refine(
          (value) => ['smtp:', 'smtps:'].includes(new URL(value).protocol),
          'SMTP_URL must use smtp or smtps',
        )
        .optional(),
    ),
    MAIL_FROM: emptyToUndefined(z.email().optional()),
    MAIL_DRIVER: emptyToUndefined(z.enum(['smtp', 'filesystem']).default('smtp')),
    PRIVATE_MAIL_DIRECTORY: emptyToUndefined(z.string().min(1).optional()),
    OUTBOX_POLL_INTERVAL_MS: emptyToUndefined(z.coerce.number().int().min(250).default(5_000)),
  })
  .transform((environment, context) => {
    if (
      environment.MAIL_DRIVER === 'filesystem' &&
      (environment.NODE_ENV === 'production' || !environment.PRIVATE_MAIL_DIRECTORY)
    )
      context.addIssue({
        code: 'custom',
        message: 'Private filesystem mail requires development/test and PRIVATE_MAIL_DIRECTORY.',
      });
    if (
      environment.CLINICAL_STORAGE_ENABLED &&
      environment.STORAGE_DRIVER === 's3' &&
      (!environment.S3_ENDPOINT ||
        !environment.S3_BUCKET ||
        !environment.S3_ACCESS_KEY ||
        !environment.S3_SECRET_KEY)
    )
      context.addIssue({
        code: 'custom',
        message: 'Private clinical storage requires all S3 configuration fields.',
      });
    if (
      environment.CLINICAL_STORAGE_ENABLED &&
      environment.STORAGE_DRIVER === 'filesystem' &&
      !environment.PRIVATE_STORAGE_DIRECTORY
    )
      context.addIssue({
        code: 'custom',
        message: 'Filesystem private storage requires PRIVATE_STORAGE_DIRECTORY.',
      });
    if (
      environment.XRAY_INFERENCE_ENABLED &&
      (!environment.CLINICAL_STORAGE_ENABLED ||
        !environment.AI_SERVICE_URL ||
        !environment.AI_SERVICE_TOKEN)
    )
      context.addIssue({
        code: 'custom',
        message: 'Inference requires private storage, AI_SERVICE_URL and AI_SERVICE_TOKEN.',
      });
    const corsOrigins = environment.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    if (corsOrigins.includes('*')) {
      context.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'Wildcard CORS origins are not allowed',
      });
      return z.NEVER;
    }

    for (const origin of corsOrigins) {
      try {
        const parsed = new URL(origin);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
          throw new Error('Origin must not include a path');
        }
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'Invalid CORS origin: use an HTTP(S) origin without credentials or a path',
        });
      }
    }

    return {
      nodeEnv: environment.NODE_ENV,
      clinicalStorageEnabled: environment.CLINICAL_STORAGE_ENABLED,
      storageDriver: environment.STORAGE_DRIVER,
      privateStorageDirectory: environment.PRIVATE_STORAGE_DIRECTORY,
      xrayInferenceEnabled: environment.XRAY_INFERENCE_ENABLED,
      s3Endpoint: environment.S3_ENDPOINT,
      s3Bucket: environment.S3_BUCKET,
      s3AccessKey: environment.S3_ACCESS_KEY,
      s3SecretKey: environment.S3_SECRET_KEY,
      aiServiceUrl: environment.AI_SERVICE_URL,
      aiServiceToken: environment.AI_SERVICE_TOKEN,
      authSecret: environment.AUTH_SECRET,
      appOrigin: environment.APP_ORIGIN,
      smtpUrl: environment.SMTP_URL,
      mailFrom: environment.MAIL_FROM,
      mailDriver: environment.MAIL_DRIVER,
      privateMailDirectory: environment.PRIVATE_MAIL_DIRECTORY,
      host: environment.HOST,
      port: environment.PORT,
      databaseUrl: environment.DATABASE_URL,
      logLevel: environment.LOG_LEVEL,
      bodyLimit: environment.BODY_LIMIT,
      corsOrigins,
      trustProxy: environment.TRUST_PROXY,
      rateLimitWindowMs: environment.RATE_LIMIT_WINDOW_MS,
      rateLimitMax: environment.RATE_LIMIT_MAX,
      shutdownTimeoutMs: environment.SHUTDOWN_TIMEOUT_MS,
      outboxWorkerEnabled: environment.OUTBOX_WORKER_ENABLED,
      outboxPollIntervalMs: environment.OUTBOX_POLL_INTERVAL_MS,
    };
  });

export type ApiEnvironment = z.infer<typeof EnvironmentSchema>;

export class EnvironmentConfigurationError extends Error {
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(error: z.ZodError) {
    super(`Invalid API environment: ${z.prettifyError(error)}`);
    this.name = 'EnvironmentConfigurationError';
    this.issues = error.issues;
  }
}

export function readEnvironment(
  source: Record<string, string | undefined> = process.env,
): ApiEnvironment {
  const result = EnvironmentSchema.safeParse(source);
  if (!result.success) {
    throw new EnvironmentConfigurationError(result.error);
  }
  return result.data;
}
