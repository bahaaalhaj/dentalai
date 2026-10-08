import { createDatabase } from '@dentalai/database';
import express, { type Express } from 'express';
import type { Server } from 'node:http';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createApplication } from './app.js';
import { EnvironmentConfigurationError, readEnvironment } from './config/environment.js';
import { PostgresSystemRepository } from './domains/system/system.repository.js';
import { SystemService } from './domains/system/system.service.js';
import { ApplicationLifecycle } from './infrastructure/lifecycle.js';
import { createLogger } from './infrastructure/logger.js';
import { OutboxWorker } from './workers/outbox.worker.js';
import { createAuthProvider } from './domains/auth/auth.provider.js';
import { smtpMailSender } from './domains/auth/mail.js';
import { AccessRepository } from './domains/access/access.repository.js';
import { drainServer } from './infrastructure/shutdown.js';

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
  if (!environment.authSecret || !environment.smtpUrl || !environment.mailFrom) {
    throw new Error(
      'AUTH_SECRET (32+ characters), SMTP_URL, and MAIL_FROM are required for backend authentication.',
    );
  }
  if (environment.nodeEnv === 'production' && !environment.appOrigin.startsWith('https://')) {
    throw new Error('APP_ORIGIN must use HTTPS in production.');
  }
  const logger = createLogger(environment.logLevel);
  const lifecycle = new ApplicationLifecycle();
  const { pool, db } = createDatabase(environment.databaseUrl);
  const authOptions = {
    secret: environment.authSecret,
    origin: environment.appOrigin,
    sendMail: smtpMailSender(environment.smtpUrl, environment.mailFrom),
  };
  const provider = createAuthProvider(db, authOptions);
  const systemService = new SystemService(new PostgresSystemRepository(pool), lifecycle);
  const worker = new OutboxWorker(pool, logger, new Map(), {
    pollIntervalMs: environment.outboxPollIntervalMs,
  });
  let closeFrontend = async () => {};
  const mountFrontend = frontendMount(process.argv.slice(2), (close) => {
    closeFrontend = close;
  });

  let server: Server;
  try {
    const application = await createApplication({
      logger,
      systemService,
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
  } catch (error) {
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
      await worker.stop();
      await pool.end();
    };

    try {
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
  const configurationMessage =
    error instanceof EnvironmentConfigurationError
      ? error.message
      : error instanceof Error &&
          (error.message.startsWith('AUTH_SECRET (') ||
            error.message.startsWith('APP_ORIGIN must use HTTPS'))
        ? error.message
        : 'Check server configuration, database availability, and the listening port.';
  logger.fatal(
    {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      message: configurationMessage,
    },
    'DentalAI API failed to start',
  );
  process.exitCode = 1;
});
