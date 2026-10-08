import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  integer,
  text,
  timestamp,
  bigint,
  foreignKey,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { clinics, memberships } from './core.js';
import { invoices, invoiceItems, priceLists, payments, refunds } from './billing.js';
import { treatmentPlanItems } from './clinical.js';
export const billingInvoiceWorkflows = pgTable(
  'billing_invoice_workflows',
  {
    invoiceId: uuid('invoice_id').primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    discardedAt: timestamp('discarded_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'billing_workflow_invoice_fk',
      columns: [t.clinicId, t.invoiceId],
      foreignColumns: [invoices.clinicId, invoices.id],
    }).onDelete('restrict'),
    check('billing_workflow_version_chk', sql`${t.version}>0`),
  ],
);
export const billingItemLinks = pgTable(
  'billing_item_links',
  {
    itemId: uuid('item_id').primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    treatmentPlanItemId: uuid('treatment_plan_item_id').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'billing_link_item_fk',
      columns: [t.clinicId, t.itemId],
      foreignColumns: [invoiceItems.clinicId, invoiceItems.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'billing_link_plan_item_fk',
      columns: [t.clinicId, t.treatmentPlanItemId],
      foreignColumns: [treatmentPlanItems.clinicId, treatmentPlanItems.id],
    }).onDelete('restrict'),
  ],
);
export const billingPricePublications = pgTable(
  'billing_price_publications',
  {
    priceListId: uuid('price_list_id').primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    currency: text('currency').notNull(),
    authorMembershipId: uuid('author_membership_id').notNull(),
    reason: text('reason').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'billing_publication_list_fk',
      columns: [t.clinicId, t.priceListId, t.currency],
      foreignColumns: [priceLists.clinicId, priceLists.id, priceLists.currency],
    }).onDelete('restrict'),
    foreignKey({
      name: 'billing_publication_author_fk',
      columns: [t.clinicId, t.authorMembershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }).onDelete('restrict'),
    check('billing_publication_reason_chk', sql`length(trim(${t.reason}))>0`),
  ],
);
export const billingLedger = pgTable(
  'billing_ledger',
  {
    id: uuid('id').primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id').notNull(),
    kind: text('kind').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    paymentId: uuid('payment_id'),
    refundId: uuid('refund_id'),
    receiptReference: text('receipt_reference'),
    authorMembershipId: uuid('author_membership_id').notNull(),
    reason: text('reason').notNull(),
    requestKey: uuid('request_key').notNull(),
    operationHash: text('operation_hash').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({
      name: 'billing_ledger_invoice_fk',
      columns: [t.clinicId, t.invoiceId, t.currency],
      foreignColumns: [invoices.clinicId, invoices.id, invoices.currency],
    }).onDelete('restrict'),
    foreignKey({
      name: 'billing_ledger_payment_fk',
      columns: [t.clinicId, t.paymentId],
      foreignColumns: [payments.clinicId, payments.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'billing_ledger_refund_fk',
      columns: [t.clinicId, t.refundId],
      foreignColumns: [refunds.clinicId, refunds.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'billing_ledger_author_fk',
      columns: [t.clinicId, t.authorMembershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }).onDelete('restrict'),
    uniqueIndex('billing_ledger_request_uidx').on(t.clinicId, t.requestKey),
    uniqueIndex('billing_ledger_receipt_uidx').on(t.clinicId, t.receiptReference),
    uniqueIndex('billing_ledger_payment_uidx')
      .on(t.clinicId, t.paymentId)
      .where(sql`${t.kind}='payment'`),
    uniqueIndex('billing_ledger_refund_uidx').on(t.clinicId, t.refundId),
    uniqueIndex('billing_ledger_issue_uidx')
      .on(t.clinicId, t.invoiceId)
      .where(sql`${t.kind}='invoice_issued'`),
    index('billing_ledger_invoice_idx').on(t.clinicId, t.invoiceId, t.recordedAt),
    check(
      'billing_ledger_kind_chk',
      sql`${t.kind} in ('draft_created','draft_revised','draft_discarded','invoice_issued','payment','refund','adjustment')`,
    ),
    check(
      'billing_ledger_amount_chk',
      sql`abs(${t.amountMinor})<=1000000000000 and ((${t.kind} in ('draft_created','draft_revised','draft_discarded') and ${t.amountMinor}=0) or (${t.kind} in ('invoice_issued','refund') and ${t.amountMinor}>0) or (${t.kind}='payment' and ${t.amountMinor}<0) or (${t.kind}='adjustment' and ${t.amountMinor}<>0))`,
    ),
    check('billing_ledger_reason_chk', sql`length(trim(${t.reason}))>0`),
    check(
      'billing_ledger_sources_chk',
      sql`(${t.kind}='payment' and ${t.paymentId} is not null and ${t.refundId} is null and ${t.receiptReference} is not null) or (${t.kind}='refund' and ${t.paymentId} is not null and ${t.refundId} is not null and ${t.receiptReference} is not null) or (${t.kind} not in ('payment','refund') and ${t.paymentId} is null and ${t.refundId} is null and ${t.receiptReference} is null)`,
    ),
  ],
);
