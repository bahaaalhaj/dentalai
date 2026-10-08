import {
  ContractDocumentParamsSchema,
  ContractDocumentQuerySchema,
  HealthCheckRequestSchema,
  LivenessResponseSchema,
  OpenApiDocumentSchema,
  ReadinessResponseSchema,
  createOpenApiDocument,
  type ContractDocumentParams,
} from '@dentalai/contracts';
import { Router, type RequestHandler } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { getValidated, sendValidated, validateRequest } from '../../middleware/validation.js';
import type { SystemService } from './system.service.js';

function livenessHandler(): RequestHandler {
  return (_request, response) => {
    sendValidated(response, LivenessResponseSchema, {
      service: 'api',
      status: 'ok',
      version: 'v1',
      timestamp: new Date().toISOString(),
    });
  };
}

export function createSystemRouter(service: SystemService): Router {
  const router = Router();

  router.get(
    '/health/live',
    validateRequest({ query: HealthCheckRequestSchema }),
    livenessHandler(),
  );

  router.get(
    '/health/ready',
    validateRequest({ query: HealthCheckRequestSchema }),
    asyncHandler(async (_request, response) => {
      const readiness = await service.readiness();
      sendValidated(
        response,
        ReadinessResponseSchema,
        readiness,
        readiness.status === 'ready' ? 200 : 503,
      );
    }),
  );

  router.get(
    '/contracts/:version',
    validateRequest({
      params: ContractDocumentParamsSchema,
      query: ContractDocumentQuerySchema,
    }),
    (_request, response) => {
      const params = getValidated<ContractDocumentParams>(response, 'params');
      if (params.version === 'v1') {
        sendValidated(response, OpenApiDocumentSchema, createOpenApiDocument());
      }
    },
  );

  return router;
}

export function createLegacyHealthHandler(): RequestHandler[] {
  return [validateRequest({ query: HealthCheckRequestSchema }), livenessHandler()];
}
