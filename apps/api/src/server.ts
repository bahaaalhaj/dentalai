import { createDatabase } from '@dentalai/database';
import express, { type Express } from 'express';
import type { Server } from 'node:http';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { ApplicationTelemetry, monitoringAuthorization } from './infrastructure/observability.js';
import { assertRestrictedDatabaseIdentity } from './infrastructure/database-identity.js';
import { createApplication } from './app.js';
import { EnvironmentConfigurationError, readEnvironment } from './config/environment.js';
import { PostgresSystemRepository } from './domains/system/system.repository.js';
import { SystemService } from './domains/system/system.service.js';
import { ApplicationLifecycle } from './infrastructure/lifecycle.js';
import { createLogger } from './infrastructure/logger.js';
import { OutboxWorker } from './workers/outbox.worker.js';
import { createAuthProvider } from './domains/auth/auth.provider.js';
import { smtpMailSender } from './domains/auth/mail.js';
import { localMailSender } from './domains/auth/local-mail.js';
import { AccessRepository } from './domains/access/access.repository.js';
import { drainServer } from './infrastructure/shutdown.js';
import { S3Client } from '@aws-sdk/client-s3';
import { S3PrivateStorage } from './domains/imaging/storage.js';
import { FilesystemPrivateStorage } from './domains/imaging/filesystem-storage.js';
import { PrivateInferenceClient } from './domains/imaging/inference.js';
import {
  notificationHandlers,
  emailNotificationProvider,
} from './domains/notifications/notification.service.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

function loadRootEnvironmentFile(): void {
  try {
    loadEnvFile(path.resolve(currentDirectory, '../../../.env'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function listen(application: Express, port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = application.listen(port, host, () => resolve(server));
    server.once('error', reject);
  });
}

function frontendMount(
  args: readonly string[],
  registerClose: (close: () => Promise<void>) => void,
) {
  if (args.includes('--api-only')) return undefined;

  const webRoot = path.resolve(currentDirectory, '../../web');
  if (args.includes('--with-vite')) {
    return async (application: Express) => {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        root: webRoot,
        configFile: path.join(webRoot, 'vite.config.ts'),
        server: { middlewareMode: true },
        appType: 'spa',
      });
      registerClose(() => vite.close());
      application.use(vite.middlewares);
    };
  }

  if (args.includes('--production')) {
    return (application: Express) => {
      const webDist = path.join(webRoot, 'dist');
      application.use(express.static(webDist));
      application.get(/^\/(?!api(?:\/|$)).*/, (_request, response) => {
        response.sendFile(path.join(webDist, 'index.html'));
      });
    };
  }

  return undefined;
}

async function startServer(): Promise<void> {
  loadRootEnvironmentFile();
  const environment = readEnvironment();
  if (
    ['staging', 'production'].includes(environment.deploymentEnv) &&
    process.argv.includes('--with-vite')
  )
    throw new Error('Development Vite middleware is prohibited in staging/production.');
  if (
    !environment.authSecret ||
    (environment.mailDriver === 'smtp' && (!environment.smtpUrl || !environment.mailFrom))
  ) {
    throw new Error(
      'AUTH_SECRET (32+ characters) and explicit mail configuration are required: SMTP_URL/MAIL_FROM, or a development-only private filesystem mailbox.',
    );
  }
  if (environment.nodeEnv === 'production' && !environment.appOrigin.startsWith('https://')) {
    throw new Error('APP_ORIGIN must use HTTPS in production.');
  }
  const logger = createLogger(environment.logLevel);
  const lifecycle = new ApplicationLifecycle();
  const { pool, db } = createDatabase(environment.databaseUrl);
  if (['staging', 'production'].includes(environment.deploymentEnv)) {
    try {
      await assertRestrictedDatabaseIdentity(pool);
    } catch {
      await pool.end();
      throw new Error('Restricted database identity verification failed.');
    }
  }
  const authOptions = {
    secret: environment.authSecret,
    origin: environment.appOrigin,
    sendMail:
      environment.mailDriver === 'filesystem' && environment.privateMailDirectory
        ? localMailSender(environment.privateMailDirectory)
        : smtpMailSender(environment.smtpUrl!, environment.mailFrom!),
  };
  const provider = createAuthProvider(db, authOptions);
  const storage =
    environment.clinicalStorageEnabled &&
    environment.storageDriver === 'filesystem' &&
    environment.privateStorageDirectory
      ? new FilesystemPrivateStorage(environment.privateStorageDirectory)
      : environment.clinicalStorageEnabled &&
          environment.s3Endpoint &&
          environment.s3Bucket &&
          environment.s3AccessKey &&
          environment.s3SecretKey
        ? new S3PrivateStorage(
            new S3Client({
              endpoint: environment.s3Endpoint,
              region: 'us-east-1',
              forcePathStyle: true,
              credentials: {
                accessKeyId: environment.s3AccessKey,
                secretAccessKey: environment.s3SecretKey,
              },
            }),
            environment.s3Bucket,
          )
        : undefined;
  const inference =
    environment.xrayInferenceEnabled && environment.aiServiceUrl && environment.aiServiceToken
      ? new PrivateInferenceClient(
          environment.aiServiceUrl.replace(/\/$/, ''),
          environment.aiServiceToken,
        )
      : undefined;
  const worker = new OutboxWorker(
    pool,
    logger,
    notificationHandlers(
      pool,
      emailNotificationProvider(authOptions.sendMail, environment.mailDriver),
      authOptions.secret,
    ),
    {
      pollIntervalMs: environment.outboxPollIntervalMs,
    },
  );
  const telemetry = new ApplicationTelemetry(logger);
  const systemService = new SystemService(new PostgresSystemRepository(pool), lifecycle, {
    storage: storage ? () => storage.health() : 'disabled',
    ai: inference ? () => inference.health() : 'disabled',
    worker: environment.outboxWorkerEnabled ? async () => worker.assertHealthy() : 'disabled',
    web: process.argv.includes('--production')
      ? () => access(path.resolve(currentDirectory, '../../web/dist/index.html'))
      : 'disabled',
  });
  let monitoringServer: Server | undefined;
  let closeFrontend = async () => {};
  const mountFrontend = frontendMount(process.argv.slice(2), (close) => {
    closeFrontend = close;
  });

  let server: Server | undefined;
  try {
    const application = await createApplication({
      logger,
      telemetry,
      systemService,
      imaging: { ...(storage ? { storage } : {}), ...(inference ? { inference } : {}) },
      authentication: {
        provider,
        repository: new AccessRepository(pool, db),
        options: authOptions,
      },
      options: {
        bodyLimit: environment.bodyLimit,
        corsOrigins: environment.corsOrigins,
        trustProxy: environment.trustProxy,
        rateLimitWindowMs: environment.rateLimitWindowMs,
        rateLimitMax: environment.rateLimitMax,
      },
      ...(mountFrontend ? { mountFrontend } : {}),
    });

    server = await listen(application, environment.port, environment.host);
    server.requestTimeout = 30000;
    server.headersTimeout = 10000;
    server.keepAliveTimeout = 5000;
    if (environment.monitoringToken) {
      const monitoring = express();
      monitoring.disable('x-powered-by');
      monitoring.use(monitoringAuthorization(environment.monitoringToken));
      monitoring.get('/metrics', async (_req, res) => {
        try {
          const queue = await pool.query<{ pending: string; exhausted: string }>(
            "SELECT count(*) FILTER(WHERE status<>'completed' AND attempts<8)::text AS pending, count(*) FILTER(WHERE status<>'completed' AND attempts>=8)::text AS exhausted FROM outbox_jobs",
          );
          res.json({ ...telemetry.snapshot(), outbox: queue.rows[0] });
        } catch {
          res.status(503).json({ error: 'METRICS_UNAVAILABLE' });
        }
      });
      monitoring.get('/ready', async (_req, res) => {
        const ready = await systemService.readiness();
        res.status(ready.status === 'ready' ? 200 : 503).json(ready);
      });
      monitoringServer = await listen(
        monitoring,
        environment.monitoringPort,
        environment.monitoringHost,
      );
    }
  } catch (error) {
    if (server) server.close();
    if (monitoringServer) monitoringServer.close();
    await Promise.allSettled([closeFrontend(), worker.stop(), pool.end()]);
    throw error;
  }
  logger.info(
    { host: environment.host, port: environment.port, apiVersion: 'v1' },
    'DentalAI API started',
  );

  if (environment.outboxWorkerEnabled) worker.start();

  let shutdownStarted = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    lifecycle.beginShutdown();
    logger.info({ signal }, 'Graceful shutdown started');

    const closeResources = async () => {
      if (monitoringServer)
        await new Promise<void>((resolve) => monitoringServer!.close(() => resolve()));
      await worker.stop();
      await pool.end();
    };

    try {
      if (server)
        await drainServer(server, closeResources, environment.shutdownTimeoutMs, closeFrontend);
      logger.info('Graceful shutdown completed');
      process.exitCode = 0;
    } catch {
      logger.error('Graceful shutdown failed');
      // Setting exitCode alone leaves hung handlers/watchers alive indefinitely.
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

startServer().catch((error: unknown) => {
  const logger = createLogger('error');
  logger.fatal(
    {
      code:
        error instanceof EnvironmentConfigurationError ? 'CONFIGURATION_INVALID' : 'STARTUP_FAILED',
    },
    'DentalAI API failed to start',
  );
  process.exitCode = 1;
});
