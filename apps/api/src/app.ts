import { ApiErrorResponseSchema } from '@dentalai/contracts';
import cors from 'cors';
import express, { type Express, type Request, type ErrorRequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { DomainError } from './errors/domain-errors.js';
import { createSystemRouter, createLegacyHealthHandler } from './domains/system/system.routes.js';
import type { SystemService } from './domains/system/system.service.js';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import type { AuthProvider, AuthOptions } from './domains/auth/auth.provider.js';
import type { AccessRepository } from './domains/access/access.repository.js';
import { createAccessRouter } from './domains/access/access.routes.js';
import { createAuthRouter } from './domains/auth/auth.routes.js';
import { csrfProtection } from './domains/auth/csrf.js';
import { createSchedulingRouter } from './domains/scheduling/scheduling.routes.js';
import { createClinicalRouter } from './domains/clinical/clinical.routes.js';
import { createBillingRouter } from './domains/billing/billing.routes.js';

export interface ApiApplicationOptions {
  bodyLimit: string;
  corsOrigins: readonly string[];
  trustProxy: boolean;
  rateLimitWindowMs: number;
  rateLimitMax: number;
}

export interface ApiApplicationDependencies {
  logger: Logger;
  systemService: SystemService;
  options: ApiApplicationOptions;
  authentication?: { provider: AuthProvider; repository: AccessRepository; options: AuthOptions };
  mountFrontend?: (application: Express) => Promise<void> | void;
}

export async function createApplication({
  logger,
  systemService,
  options,
  authentication,
  mountFrontend,
}: ApiApplicationDependencies): Promise<Express> {
  const application = express();
  application.disable('x-powered-by');
  if (options.trustProxy) application.set('trust proxy', 1);

  application.use(requestIdMiddleware);
  application.use(
    pinoHttp({
      logger,
      genReqId: (request) => (request as Request).requestId,
      customProps: (request) => ({ requestId: (request as Request).requestId }),
      serializers: {
        req: (request) => ({ method: request.method, path: String(request.url).split('?')[0] }),
        res: (response) => ({ statusCode: response.statusCode }),
      },
    }),
  );
  application.use(helmet());
  application.use(
    cors({
      origin(origin, callback) {
        if (
          !origin ||
          origin === authentication?.options.origin ||
          options.corsOrigins.includes(origin)
        ) {
          callback(null, true);
          return;
        }
        callback(new DomainError('CORS_ORIGIN_DENIED', 'The request origin is not allowed.', 403));
      },
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'x-request-id', 'x-csrf-token'],
      exposedHeaders: ['x-request-id', 'ratelimit', 'ratelimit-policy'],
      maxAge: 600,
    }),
  );
  application.use(express.json({ limit: options.bodyLimit, strict: true }));
  application.use(express.urlencoded({ extended: false, limit: options.bodyLimit }));

  const apiRateLimit = rateLimit({
    windowMs: options.rateLimitWindowMs,
    limit: options.rateLimitMax,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(request, response) {
      const body = ApiErrorResponseSchema.parse({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Try again later.',
          requestId: request.requestId,
        },
      });
      response.status(429).json(body);
    },
  });

  application.use('/api/v1', apiRateLimit, createSystemRouter(systemService));
  if (authentication) {
    const csrf = csrfProtection(authentication.options.secret, authentication.options.origin);
    application.get('/api/v1/access/csrf', csrf.issue);
    application.use(
      '/api/v1/auth',
      csrf.verify,
      createAuthRouter(authentication.provider, authentication.repository, authentication.options),
    );
    application.use(
      '/api/v1/access',
      csrf.verify,
      createAccessRouter(
        authentication.provider,
        authentication.repository,
        authentication.options,
      ),
    );
    application.use(
      '/api/v1',
      csrf.verify,
      createSchedulingRouter(authentication.provider, authentication.repository),
    );
    application.use(
      '/api/v1',
      csrf.verify,
      createClinicalRouter(authentication.provider, authentication.repository),
    );
    application.use(
      '/api/v1',
      csrf.verify,
      createBillingRouter(authentication.provider, authentication.repository),
    );
  }
  application.get('/api/health', ...createLegacyHealthHandler());

  if (mountFrontend) await mountFrontend(application);

  application.use(notFoundHandler());
  if (authentication) {
    const auditRejected: ErrorRequestHandler = (error: unknown, request, _response, next) => {
      if (
        request.path.startsWith('/api/v1/auth/') ||
        request.path.startsWith('/api/v1/access/') ||
        request.path.startsWith('/api/v1/appointments') ||
        request.path.startsWith('/api/v1/scheduling/') ||
        request.path.startsWith('/api/v1/clinical/') ||
        request.path.startsWith('/api/v1/billing/')
      ) {
        void authentication.repository
          .security('auth.request_rejected', false, undefined, request.requestId)
          .then(
            () => next(error),
            (auditError: unknown) => next(auditError),
          );
      } else next(error);
    };
    application.use(auditRejected);
  }
  application.use(createErrorHandler(logger));
  return application;
}
