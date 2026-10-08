import { Router } from 'express';
import {
  billingContracts,
  type InvoiceWriteSchema,
  type DraftReplaceSchema,
  type InvoiceActionSchema,
  type PaymentWriteSchema,
  type RefundWriteSchema,
  type AdjustmentWriteSchema,
  type ServiceWriteSchema,
  type PricingWriteSchema,
} from '@dentalai/contracts';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async-handler.js';
import { getValidated, sendValidated, validateRequest } from '../../middleware/validation.js';
import { authenticatedContext } from '../access/access.routes.js';
import type { AccessRepository } from '../access/access.repository.js';
import type { AuthProvider } from '../auth/auth.provider.js';
import { BillingRepository } from './billing.repository.js';
export function createBillingRouter(auth: AuthProvider, access: AccessRepository) {
  const router = Router(),
    repository = new BillingRepository(access.pool);
  router.use((_req, res, next) => {
    res.setHeader('cache-control', 'no-store');
    next();
  });
  for (const contract of billingContracts) {
    const path = contract.path.replace('/api/v1', '').replace('{id}', ':id');
    router[contract.method](
      path,
      validateRequest({
        query: z.object({}).strict(),
        ...('params' in contract ? { params: contract.params } : {}),
        ...('body' in contract ? { body: contract.body } : {}),
      }),
      asyncHandler(async (req, res) => {
        const c = await authenticatedContext(auth, access, req),
          id = getValidated<{ id: string }>(res, 'params')?.id;
        let result: unknown;
        if (path === '/billing/catalog') result = await repository.catalog(c);
        else if (path === '/billing/invoices' && contract.method === 'get')
          result = await repository.list(c);
        else if (path === '/billing/portal') result = await repository.list(c, true);
        else if (path === '/billing/reports') result = await repository.reports(c);
        else if (path.endsWith('/links')) result = await repository.links(c, id);
        else if (path === '/billing/services')
          result = await repository.service(
            c,
            getValidated<z.infer<typeof ServiceWriteSchema>>(res, 'body'),
          );
        else if (path === '/billing/price-lists')
          result = await repository.pricing(
            c,
            getValidated<z.infer<typeof PricingWriteSchema>>(res, 'body'),
          );
        else if (path === '/billing/invoices')
          result = await repository.create(
            c,
            getValidated<z.infer<typeof InvoiceWriteSchema>>(res, 'body'),
          );
        else if (path.endsWith('/draft'))
          result = await repository.mutate(
            c,
            id,
            'draft_revised',
            getValidated<z.infer<typeof DraftReplaceSchema>>(res, 'body'),
          );
        else if (path.endsWith('/issue'))
          result = await repository.mutate(
            c,
            id,
            'invoice_issued',
            getValidated<z.infer<typeof InvoiceActionSchema>>(res, 'body'),
          );
        else if (path.endsWith('/discard'))
          result = await repository.mutate(
            c,
            id,
            'draft_discarded',
            getValidated<z.infer<typeof InvoiceActionSchema>>(res, 'body'),
          );
        else if (path.endsWith('/payments'))
          result = await repository.mutate(
            c,
            id,
            'payment',
            getValidated<z.infer<typeof PaymentWriteSchema>>(res, 'body'),
          );
        else if (path.endsWith('/refunds'))
          result = await repository.mutate(
            c,
            id,
            'refund',
            getValidated<z.infer<typeof RefundWriteSchema>>(res, 'body'),
          );
        else
          result = await repository.mutate(
            c,
            id,
            'adjustment',
            getValidated<z.infer<typeof AdjustmentWriteSchema>>(res, 'body'),
          );
        sendValidated<unknown>(res, contract.response, result);
      }),
    );
  }
  return router;
}
