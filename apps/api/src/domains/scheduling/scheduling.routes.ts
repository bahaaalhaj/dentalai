import { Router } from 'express';
import type { z } from 'zod';
import {
  appointmentContracts,
  BookingSchema,
  StaffBookingSchema,
  AppointmentActionSchema,
  RescheduleSchema,
  AvailabilityQuerySchema,
  AppointmentListQuerySchema,
} from '@dentalai/contracts';
import { asyncHandler } from '../../middleware/async-handler.js';
import { getValidated, sendValidated, validateRequest } from '../../middleware/validation.js';
import { authenticatedContext } from '../access/access.routes.js';
import type { AccessRepository } from '../access/access.repository.js';
import type { AuthProvider } from '../auth/auth.provider.js';
import { SchedulingRepository } from './scheduling.repository.js';

export function createSchedulingRouter(
  auth: AuthProvider,
  accessRepository: AccessRepository,
): Router {
  const router = Router();
  const repository = new SchedulingRepository(accessRepository.pool);
  router.use((_request, response, next) => {
    response.setHeader('cache-control', 'no-store');
    next();
  });
  for (const contract of appointmentContracts) {
    const path = contract.path.replace('/api/v1', '').replace('{id}', ':id');
    router[contract.method](
      path,
      validateRequest({
        ...('body' in contract ? { body: contract.body } : {}),
        ...('params' in contract ? { params: contract.params } : {}),
        ...('query' in contract ? { query: contract.query } : {}),
      }),
      asyncHandler(async (request, response) => {
        const context = await authenticatedContext(auth, accessRepository, request);
        const id = getValidated<{ id: string }>(response, 'params')?.id;
        let result: unknown;
        if (path === '/scheduling/catalog') result = await repository.catalog(context);
        else if (path === '/scheduling/availability')
          result = await repository.availability(
            context,
            getValidated<z.infer<typeof AvailabilityQuerySchema>>(response, 'query'),
          );
        else if (path === '/appointments' && contract.method === 'get')
          result = await repository.list(
            context,
            getValidated<z.infer<typeof AppointmentListQuerySchema>>(response, 'query'),
          );
        else if (path === '/appointments' && contract.method === 'post')
          result = await repository.book(
            context,
            getValidated<z.infer<typeof BookingSchema>>(response, 'body').slotToken,
          );
        else if (path === '/appointments/staff') {
          const body = getValidated<z.infer<typeof StaffBookingSchema>>(response, 'body');
          result = await repository.book(context, body.slotToken, body.patientId);
        } else if (path === '/appointments/:id') result = await repository.get(context, id);
        else if (path === '/appointments/:id/history')
          result = await repository.history(context, id);
        else if (path === '/appointments/:id/actions')
          result = await repository.action(
            context,
            id,
            getValidated<z.infer<typeof AppointmentActionSchema>>(response, 'body'),
          );
        else if (path === '/appointments/:id/reschedule') {
          const body = getValidated<z.infer<typeof RescheduleSchema>>(response, 'body');
          result = await repository.reschedule(context, id, body.slotToken, body.revision);
        } else if (contract.method === 'delete')
          result = await repository.removeConfiguration(
            context,
            path.includes('/hours/') ? 'hour' : 'closure',
            id,
          );
        else {
          const kind = path.endsWith('/operatories')
            ? 'operatory'
            : path.endsWith('/types')
              ? 'type'
              : path.endsWith('/hours')
                ? 'hour'
                : path.endsWith('/closures')
                  ? 'closure'
                  : 'policy';
          result = await repository.configure(context, kind, getValidated(response, 'body'));
        }
        sendValidated<unknown>(response, contract.response, result);
      }),
    );
  }
  return router;
}
