import { z } from 'zod';
import { MAX_MONEY_MINOR } from '@dentalai/domain';
import { IdParamsSchema, SuccessSchema } from './auth.js';
import { PatientSummarySchema } from './clinical.js';
const text = z.string().trim().min(1).max(1000);
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);
export const MinorSchema = z.number().int().min(0).max(MAX_MONEY_MINOR);
const positive = MinorSchema.min(1);
const reasonKey = { reason: text, requestKey: z.uuid() };
export const ServiceWriteSchema = z
  .object({ code: text.max(50), name: text.max(200), reason: text })
  .strict();
export const PricingWriteSchema = z
  .object({
    name: text.max(200),
    currency: CurrencySchema,
    items: z
      .array(z.object({ serviceId: z.uuid(), amountMinor: MinorSchema }).strict())
      .min(1)
      .max(100),
    reason: text,
  })
  .strict()
  .refine(
    (v) => new Set(v.items.map((i) => i.serviceId)).size === v.items.length,
    'Duplicate service.',
  );
export const BillingLineInputSchema = z
  .object({
    priceItemId: z.uuid(),
    quantityHundredths: z.number().int().min(1).max(1_000_000),
    discountMinor: MinorSchema,
    taxMinor: MinorSchema,
    procedureId: z.uuid().nullable(),
    treatmentPlanItemId: z.uuid().nullable(),
  })
  .strict();
export const InvoiceWriteSchema = z
  .object({
    patientId: z.uuid(),
    priceListId: z.uuid(),
    items: z.array(BillingLineInputSchema).min(1).max(100),
    ...reasonKey,
  })
  .strict();
export const DraftReplaceSchema = InvoiceWriteSchema.omit({ patientId: true }).extend({
  expectedVersion: z.number().int().positive(),
});
export const InvoiceActionSchema = z
  .object({ expectedVersion: z.number().int().positive(), ...reasonKey })
  .strict();
export const PaymentWriteSchema = z
  .object({
    amountMinor: positive,
    currency: CurrencySchema,
    method: z.enum(['cash', 'card', 'bank_transfer', 'insurance', 'other']),
    externalReference: text.nullable(),
    ...reasonKey,
  })
  .strict();
export const RefundWriteSchema = z
  .object({
    paymentId: z.uuid(),
    amountMinor: positive,
    currency: CurrencySchema,
    externalReference: text.nullable(),
    ...reasonKey,
  })
  .strict();
export const AdjustmentWriteSchema = z
  .object({
    amountMinor: z
      .number()
      .int()
      .min(-MAX_MONEY_MINOR)
      .max(MAX_MONEY_MINOR)
      .refine((n) => n !== 0, 'Adjustment must not be zero.'),
    currency: CurrencySchema,
    ...reasonKey,
  })
  .strict();
export const BillingEventSchema = z.object({
  id: z.uuid(),
  kind: z.enum([
    'draft_created',
    'draft_revised',
    'draft_discarded',
    'invoice_issued',
    'payment',
    'refund',
    'adjustment',
  ]),
  amountMinor: z.number().int(),
  currency: CurrencySchema,
  recordedAt: z.iso.datetime(),
  receiptReference: z.string().nullable(),
  paymentId: z.uuid().nullable(),
  refundId: z.uuid().nullable(),
  method: z.string().nullable(),
  reason: z.string().optional(),
});
const AggregateMinorSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const BillingInvoiceSchema = z.object({
  id: z.uuid(),
  patientId: z.uuid(),
  invoiceNumber: z.string(),
  currency: CurrencySchema,
  status: z.enum(['draft', 'discarded', 'issued', 'partially_paid', 'paid']),
  version: z.number().int().positive(),
  issuedAt: z.iso.datetime().nullable(),
  originalTotalMinor: MinorSchema,
  adjustedTotalMinor: MinorSchema,
  paymentsMinor: AggregateMinorSchema,
  refundsMinor: AggregateMinorSchema,
  balanceMinor: MinorSchema,
  items: z.array(
    z.object({
      id: z.uuid(),
      description: z.string(),
      quantityHundredths: z.number().int(),
      unitAmountMinor: MinorSchema,
      discountMinor: MinorSchema,
      taxMinor: MinorSchema,
      lineTotalMinor: MinorSchema,
      procedureId: z.uuid().nullable(),
      treatmentPlanItemId: z.uuid().nullable(),
    }),
  ),
  events: z.array(BillingEventSchema),
});
export const BillingMutationSchema = z.object({
  invoice: BillingInvoiceSchema,
  receiptReference: z.string().nullable(),
});
export const BillingCatalogSchema = z.object({
  services: z.array(
    z.object({ id: z.uuid(), code: z.string(), name: z.string(), active: z.boolean() }),
  ),
  priceLists: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      currency: CurrencySchema,
      items: z.array(
        z.object({
          id: z.uuid(),
          serviceId: z.uuid(),
          serviceName: z.string(),
          amountMinor: MinorSchema,
        }),
      ),
    }),
  ),
  patients: z.array(PatientSummarySchema),
  permissions: z.object({ write: z.boolean(), manage: z.boolean() }),
});
export const BillingLinksSchema = z.array(
  z.object({ id: z.uuid(), kind: z.enum(['procedure', 'plan_item']), description: z.string() }),
);
export const BillingReportSchema = z.array(
  z.object({
    currency: CurrencySchema,
    invoiceCount: z.number().int(),
    issuedMinor: AggregateMinorSchema,
    adjustmentMinor: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
    adjustedTotalMinor: AggregateMinorSchema,
    paymentsMinor: AggregateMinorSchema,
    refundsMinor: AggregateMinorSchema,
    balanceMinor: AggregateMinorSchema,
  }),
);
export const billingContracts = [
  { method: 'get', path: '/api/v1/billing/catalog', response: BillingCatalogSchema, public: false },
  {
    method: 'get',
    path: '/api/v1/billing/invoices',
    response: z.array(BillingInvoiceSchema),
    public: false,
  },
  {
    method: 'get',
    path: '/api/v1/billing/portal',
    response: z.array(BillingInvoiceSchema),
    public: false,
  },
  { method: 'get', path: '/api/v1/billing/reports', response: BillingReportSchema, public: false },
  {
    method: 'get',
    path: '/api/v1/billing/patients/{id}/links',
    params: IdParamsSchema,
    response: BillingLinksSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/billing/services',
    body: ServiceWriteSchema,
    response: SuccessSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/billing/price-lists',
    body: PricingWriteSchema,
    response: SuccessSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/billing/invoices',
    body: InvoiceWriteSchema,
    response: BillingMutationSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/billing/invoices/{id}/draft',
    params: IdParamsSchema,
    body: DraftReplaceSchema,
    response: BillingMutationSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/billing/invoices/{id}/issue',
    params: IdParamsSchema,
    body: InvoiceActionSchema,
    response: BillingMutationSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/billing/invoices/{id}/discard',
    params: IdParamsSchema,
    body: InvoiceActionSchema,
    response: BillingMutationSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/billing/invoices/{id}/payments',
    params: IdParamsSchema,
    body: PaymentWriteSchema,
    response: BillingMutationSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/billing/invoices/{id}/refunds',
    params: IdParamsSchema,
    body: RefundWriteSchema,
    response: BillingMutationSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/billing/invoices/{id}/adjustments',
    params: IdParamsSchema,
    body: AdjustmentWriteSchema,
    response: BillingMutationSchema,
    public: false,
  },
] as const;
export type BillingInvoice = z.infer<typeof BillingInvoiceSchema>;
export type BillingCatalog = z.infer<typeof BillingCatalogSchema>;
export type BillingLineInput = z.infer<typeof BillingLineInputSchema>;
