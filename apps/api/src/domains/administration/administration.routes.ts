import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { z } from 'zod';
import {
  administrationContracts,
  ApiErrorResponseSchema,
  AdministrationExportFileContract,
  OnboardingSchema,
  ConfigurationWriteSchema,
  MemberChangeSchema,
  LocationWriteSchema,
  SubscriptionActionSchema,
  NotificationPreferenceSchema,
  ExportRequestSchema,
  OffboardingSchema,
} from '@dentalai/contracts';
import { asyncHandler } from '../../middleware/async-handler.js';
import { getValidated, sendValidated, validateRequest } from '../../middleware/validation.js';
import { authenticatedContext } from '../access/access.routes.js';
import type { AccessRepository } from '../access/access.repository.js';
import type { AuthProvider, AuthOptions } from '../auth/auth.provider.js';
import type { PrivateStorage } from '../imaging/storage.js';
import { AdministrationRepository } from './administration.repository.js';
export function createAdministrationRouter(
  auth: AuthProvider,
  access: AccessRepository,
  options: AuthOptions,
  storage?: PrivateStorage,
) {
  const router = Router(),
    repository = new AdministrationRepository(access.pool, options, storage);
  router.use(
    '/admin/exports',
    rateLimit({
      windowMs: 60000,
      limit: 3,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler(req, res) {
        res.setHeader('cache-control', 'private, no-store');
        res.status(429).json(
          ApiErrorResponseSchema.parse({
            error: {
              code: 'RATE_LIMITED',
              message: 'Wait before requesting another export.',
              requestId: req.requestId,
            },
          }),
        );
      },
    }),
  );
  router.use('/admin', (_req, res, next) => {
    res.setHeader('cache-control', 'private, no-store');
    next();
  });
  for (const contract of administrationContracts) {
    const path = contract.path.replace('/api/v1', '').replace('{id}', ':id');
    router[contract.method](
      path,
      validateRequest({
        ...('body' in contract ? { body: contract.body } : {}),
        ...('params' in contract ? { params: contract.params } : {}),
      }),
      asyncHandler(async (req, res) => {
        const context = await authenticatedContext(auth, access, req);
        const body = <T>() => getValidated<T>(res, 'body');
        let result: unknown;
        if (path === '/admin/onboarding')
          result = await repository.onboard(context, body<z.infer<typeof OnboardingSchema>>());
        else if (path === '/admin/overview') result = await repository.overview(context);
        else if (path === '/admin/plans') result = await repository.plans(context);
        else if (path === '/admin/configuration')
          result = await repository.configure(
            context,
            body<z.infer<typeof ConfigurationWriteSchema>>(),
          );
        else if (path === '/admin/subscription')
          result = await repository.subscriptionAction(
            context,
            body<z.infer<typeof SubscriptionActionSchema>>(),
          );
        else if (path === '/admin/members/:id')
          result = await repository.member(
            context,
            getValidated<{ id: string }>(res, 'params').id,
            body<z.infer<typeof MemberChangeSchema>>(),
          );
        else if (path === '/admin/locations')
          result = await repository.location(context, body<z.infer<typeof LocationWriteSchema>>());
        else if (path === '/admin/audit') result = await repository.auditSummary(context);
        else if (path === '/admin/notifications') result = await repository.notifications(context);
        else if (path === '/admin/notification-preferences')
          result = await repository.preferences(
            context,
            contract.method === 'put'
              ? body<z.infer<typeof NotificationPreferenceSchema>>().operationalEmail
              : undefined,
          );
        else if (path === '/admin/exports')
          result = await repository.export(
            context,
            body<z.infer<typeof ExportRequestSchema>>().reason,
          );
        else if (path === '/admin/offboarding/request')
          result = await repository.requestOffboarding(
            context,
            body<z.infer<typeof ExportRequestSchema>>().reason,
          );
        else result = await repository.offboard(context, body<z.infer<typeof OffboardingSchema>>());
        sendValidated<unknown>(res, contract.response, result);
      }),
    );
  }
  router.get(
    AdministrationExportFileContract.path.replace('/api/v1', '').replace('{id}', ':id'),
    validateRequest({ params: AdministrationExportFileContract.params }),
    asyncHandler(async (req, res) => {
      const result = await repository.exportFile(
        await authenticatedContext(auth, access, req),
        getValidated<{ id: string }>(res, 'params').id,
      );
      res
        .set({
          'content-type': result.contentType,
          'content-disposition': 'attachment; filename="clinical-file"',
          'x-content-type-options': 'nosniff',
        })
        .send(result.bytes);
    }),
  );
  return router;
}
