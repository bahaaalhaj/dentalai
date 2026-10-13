import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import {
  ImagingHistorySchema,
  ImagingImageSchema,
  ImagingRunSchema,
  ImagingReasonSchema,
  ImagingReviewSchema,
  SuccessSchema,
  ImagingCapabilitiesSchema,
} from '@dentalai/contracts';
import type { AccessRepository } from '../access/access.repository.js';
import type { AuthProvider } from '../auth/auth.provider.js';
import { authenticatedContext } from '../access/access.routes.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { DomainError } from '../../errors/domain-errors.js';
import type { PrivateStorage } from './storage.js';
import type { InferenceClient } from './inference.js';
import { ImagingRepository } from './imaging.repository.js';

export function createImagingRouter(
  auth: AuthProvider,
  access: AccessRepository,
  storage?: PrivateStorage,
  inference?: InferenceClient,
) {
  const router = Router();
  router.use(
    '/imaging',
    rateLimit({
      windowMs: 60000,
      limit: 60,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(
          new DomainError(
            'RATE_LIMITED',
            'Too many clinical image requests. Try again later.',
            429,
          ),
        ),
    }),
  );
  const repository = new ImagingRepository(access.pool, storage, inference);
  const id = (value: unknown) => z.uuid().parse(value);
  const requestKey = (value: unknown) => z.uuid().optional().parse(value);
  router.get(
    '/imaging/capabilities',
    asyncHandler(async (req, res) => {
      res.setHeader('cache-control', 'no-store');
      res.json(
        ImagingCapabilitiesSchema.parse(
          await repository.capabilities(await authenticatedContext(auth, access, req)),
        ),
      );
    }),
  );
  router.get(
    '/imaging/patients/:id',
    asyncHandler(async (req, res) => {
      res.setHeader('cache-control', 'no-store');
      res.json(
        ImagingHistorySchema.parse(
          await repository.history(
            await authenticatedContext(auth, access, req),
            id(req.params['id']),
          ),
        ),
      );
    }),
  );
  router.post(
    '/imaging/patients/:id/images',
    asyncHandler(async (req, _res, next) => {
      const context = await authenticatedContext(auth, access, req);
      await repository.history(context, id(req.params['id']));
      next();
    }),
    express.raw({ type: ['image/png', 'image/jpeg'], limit: '10mb' }),
    asyncHandler(async (req, res) => {
      const encoded = req.headers['x-imaging-reason'];
      let decoded: string | undefined;
      try {
        decoded = typeof encoded === 'string' ? decodeURIComponent(encoded) : undefined;
      } catch {
        throw new DomainError('VALIDATION_FAILED', 'Invalid upload reason.', 422);
      }
      const reason = ImagingReasonSchema.parse({ reason: decoded }).reason;
      const query = z.object({ studyId: z.uuid().optional() }).strict().parse(req.query);
      if (!Buffer.isBuffer(req.body))
        throw new DomainError('INVALID_IMAGE', 'Only PNG and JPEG uploads are supported.', 422);
      const result = await repository.upload(
        await authenticatedContext(auth, access, req),
        id(req.params['id']),
        req.body,
        String(req.headers['content-type']),
        reason,
        query.studyId,
        requestKey(req.headers['idempotency-key']),
      );
      res.status(201).json(ImagingImageSchema.parse(result));
    }),
  );
  router.get(
    '/imaging/images/:id/content',
    asyncHandler(async (req, res) => {
      const result = await repository.content(
        await authenticatedContext(auth, access, req),
        id(req.params['id']),
      );
      res
        .set({
          'cache-control': 'private, no-store',
          'content-type': result.contentType,
          'content-disposition': 'inline; filename="clinical-image.png"',
          'x-content-type-options': 'nosniff',
        })
        .send(result.data);
    }),
  );
  router.post(
    '/imaging/images/:id/analyses',
    asyncHandler(async (req, res) => {
      const body = ImagingReasonSchema.parse(req.body);
      res
        .status(201)
        .json(
          ImagingRunSchema.parse(
            await repository.analyze(
              await authenticatedContext(auth, access, req),
              id(req.params['id']),
              body.reason,
              requestKey(req.headers['idempotency-key']),
            ),
          ),
        );
    }),
  );
  router.post(
    '/imaging/analyses/:id/review',
    asyncHandler(async (req, res) => {
      const body = ImagingReviewSchema.parse(req.body);
      res.json(
        SuccessSchema.parse(
          await repository.review(
            await authenticatedContext(auth, access, req),
            id(req.params['id']),
            body.decision,
            body.reason,
          ),
        ),
      );
    }),
  );
  return router;
}
