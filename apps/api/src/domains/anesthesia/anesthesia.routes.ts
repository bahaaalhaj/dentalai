import { Router } from 'express';
import { z } from 'zod';
import {
  AnesthesiaWriteSchema,
  AnesthesiaHistorySchema,
  AnesthesiaAssessmentSchema,
  AnesthesiaConfirmSchema,
} from '@dentalai/contracts';
import type { AuthProvider } from '../auth/auth.provider.js';
import type { AccessRepository } from '../access/access.repository.js';
import { authenticatedContext } from '../access/access.routes.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { AnesthesiaRepository } from './anesthesia.repository.js';

export function createAnesthesiaRouter(auth: AuthProvider, access: AccessRepository) {
  const router = Router();
  const repository = new AnesthesiaRepository(access.pool);
  router.use('/anesthesia', (_req, res, next) => {
    res.setHeader('cache-control', 'no-store');
    next();
  });
  router.get(
    '/anesthesia/patients/:id',
    asyncHandler(async (req, res) => {
      z.object({}).strict().parse(req.query);
      res.json(
        AnesthesiaHistorySchema.parse(
          await repository.history(
            await authenticatedContext(auth, access, req),
            z.uuid().parse(req.params['id']),
          ),
        ),
      );
    }),
  );
  router.post(
    '/anesthesia/patients/:id/assessments',
    asyncHandler(async (req, res) => {
      const context = await authenticatedContext(auth, access, req);
      z.object({}).strict().parse(req.query);
      const body = AnesthesiaWriteSchema.parse(req.body);
      res
        .status(201)
        .json(
          AnesthesiaAssessmentSchema.parse(
            await repository.create(context, z.uuid().parse(req.params['id']), body),
          ),
        );
    }),
  );
  router.post(
    '/anesthesia/assessments/:id/confirm',
    asyncHandler(async (req, _res) => {
      const context = await authenticatedContext(auth, access, req);
      z.object({}).strict().parse(req.query);
      AnesthesiaConfirmSchema.parse(req.body);
      await repository.confirm(context, z.uuid().parse(req.params['id']));
    }),
  );
  return router;
}
