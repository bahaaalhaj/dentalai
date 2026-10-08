import { Router } from 'express';
import {
  clinicalContracts,
  type ClinicalWrite,
  type ClinicalReviewSchema,
  type EncounterCreateSchema,
  type ClinicalQuerySchema,
} from '@dentalai/contracts';
import type { z } from 'zod';
import { asyncHandler } from '../../middleware/async-handler.js';
import { getValidated, sendValidated, validateRequest } from '../../middleware/validation.js';
import { authenticatedContext } from '../access/access.routes.js';
import type { AccessRepository } from '../access/access.repository.js';
import type { AuthProvider } from '../auth/auth.provider.js';
import { ClinicalRepository } from './clinical.repository.js';

export function createClinicalRouter(auth: AuthProvider, access: AccessRepository) {
  const router = Router();
  const repository = new ClinicalRepository(access.pool);
  router.use((_req, res, next) => {
    res.setHeader('cache-control', 'no-store');
    next();
  });
  for (const contract of clinicalContracts) {
    const path = contract.path.replace('/api/v1', '').replace('{id}', ':id');
    router[contract.method](
      path,
      validateRequest({
        ...('body' in contract ? { body: contract.body } : {}),
        ...('params' in contract ? { params: contract.params } : {}),
        ...('query' in contract ? { query: contract.query } : {}),
      }),
      asyncHandler(async (req, res) => {
        const context = await authenticatedContext(auth, access, req);
        const id = getValidated<{ id: string }>(res, 'params')?.id;
        const query = getValidated<z.infer<typeof ClinicalQuerySchema>>(res, 'query');
        let result: unknown;
        if (path === '/clinical/patients') result = await repository.directory(context);
        else if (path === '/clinical/portal')
          result = await repository.portal(context, query.encounterId);
        else if (contract.method === 'get')
          result = await repository.workspace(context, id, query.encounterId);
        else if (path.endsWith('/encounters')) {
          const body = getValidated<z.infer<typeof EncounterCreateSchema>>(res, 'body');
          result = await repository.startEncounter(context, id, body.reason, body.appointmentId);
        } else if (path.endsWith('/records'))
          result = await repository.write(context, id, getValidated<ClinicalWrite>(res, 'body'));
        else if (path.endsWith('/review')) {
          const body = getValidated<z.infer<typeof ClinicalReviewSchema>>(res, 'body');
          result = await repository.review(context, id, body.decision, body.reason);
        } else
          result = await repository.close(
            context,
            id,
            getValidated<{ reason: string }>(res, 'body').reason,
          );
        sendValidated<unknown>(res, contract.response, result);
      }),
    );
  }
  return router;
}
