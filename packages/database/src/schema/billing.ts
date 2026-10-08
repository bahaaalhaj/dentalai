import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { encounters, procedures } from './clinical.js';
import { clinics, patients } from './core.js';
import { invoiceStatus, paymentMethod, paymentStatus, refundStatus } from './enums.js';

const createdAt = timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

export const services = pgTable(
  'services',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    active: boolean('active').default(true).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('services_clinic_code_uidx').on(table.clinicId, table.code),
    uniqueIndex('services_clinic_id_uidx').on(table.clinicId, table.id),
  ],
);

export const priceLists = pgTable(
  'price_lists',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    currency: text('currency').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveThrough: timestamp('effective_through', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex('price_lists_clinic_name_effective_uidx').on(
      table.clinicId,
      table.name,
      table.effectiveFrom,
    ),
    uniqueIndex('price_lists_clinic_id_currency_uidx').on(table.clinicId, table.id, table.currency),
    check('price_lists_currency_chk', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      'price_lists_range_chk',
      sql`${table.effectiveThrough} is null or ${table.effectiveFrom} < ${table.effectiveThrough}`,
    ),
  ],
);

export const priceListItems = pgTable(
  'price_list_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    priceListId: uuid('price_list_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex('price_list_items_service_uidx').on(
      table.clinicId,
      table.priceListId,
      table.serviceId,
    ),
    uniqueIndex('price_list_items_clinic_id_uidx').on(table.clinicId, table.id),
    foreignKey({
      columns: [table.clinicId, table.priceListId, table.currency],
      foreignColumns: [priceLists.clinicId, priceLists.id, priceLists.currency],
      name: 'price_list_items_list_currency_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.serviceId],
      foreignColumns: [services.clinicId, services.id],
      name: 'price_list_items_service_tenant_fk',
    }).onDelete('restrict'),
    check('price_list_items_amount_chk', sql`${table.amountMinor} >= 0`),
    check('price_list_items_currency_chk', sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id').notNull(),
    encounterId: uuid('encounter_id'),
    invoiceNumber: text('invoice_number').notNull(),
    status: invoiceStatus('status').default('draft').notNull(),
    currency: text('currency').notNull(),
    subtotalMinor: bigint('subtotal_minor', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    discountMinor: bigint('discount_minor', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    taxMinor: bigint('tax_minor', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    totalMinor: bigint('total_minor', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    balanceMinor: bigint('balance_minor', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('invoices_clinic_number_uidx').on(table.clinicId, table.invoiceNumber),
    uniqueIndex('invoices_clinic_id_uidx').on(table.clinicId, table.id),
    uniqueIndex('invoices_clinic_id_currency_uidx').on(table.clinicId, table.id, table.currency),
    index('invoices_patient_idx').on(table.clinicId, table.patientId, table.createdAt),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: 'invoices_patient_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.encounterId],
      foreignColumns: [encounters.clinicId, encounters.id],
      name: 'invoices_encounter_tenant_fk',
    }).onDelete('restrict'),
    check('invoices_currency_chk', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      'invoices_amounts_chk',
      sql`${table.subtotalMinor} >= 0 and ${table.discountMinor} >= 0 and ${table.taxMinor} >= 0 and ${table.totalMinor} >= 0 and ${table.balanceMinor} >= 0 and ${table.balanceMinor} <= ${table.totalMinor}`,
    ),
    check(
      'invoices_total_chk',
      sql`${table.totalMinor} = ${table.subtotalMinor} - ${table.discountMinor} + ${table.taxMinor}`,
    ),
    check('invoices_issued_chk', sql`${table.status} = 'draft' or ${table.issuedAt} is not null`),
  ],
);

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id').notNull(),
    serviceId: uuid('service_id'),
    procedureId: uuid('procedure_id'),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).default('1').notNull(),
    unitAmountMinor: bigint('unit_amount_minor', { mode: 'bigint' }).notNull(),
    discountMinor: bigint('discount_minor', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    taxMinor: bigint('tax_minor', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    lineTotalMinor: bigint('line_total_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex('invoice_items_clinic_id_uidx').on(table.clinicId, table.id),
    index('invoice_items_invoice_idx').on(table.clinicId, table.invoiceId),
    foreignKey({
      columns: [table.clinicId, table.invoiceId, table.currency],
      foreignColumns: [invoices.clinicId, invoices.id, invoices.currency],
      name: 'invoice_items_invoice_currency_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.serviceId],
      foreignColumns: [services.clinicId, services.id],
      name: 'invoice_items_service_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.procedureId],
      foreignColumns: [procedures.clinicId, procedures.id],
      name: 'invoice_items_procedure_tenant_fk',
    }).onDelete('restrict'),
    check('invoice_items_quantity_chk', sql`${table.quantity} > 0`),
    check(
      'invoice_items_amounts_chk',
      sql`${table.unitAmountMinor} >= 0 and ${table.discountMinor} >= 0 and ${table.taxMinor} >= 0 and ${table.lineTotalMinor} >= 0`,
    ),
    check('invoice_items_currency_chk', sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id').notNull(),
    invoiceId: uuid('invoice_id'),
    status: paymentStatus('status').default('pending').notNull(),
    method: paymentMethod('method').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    externalReference: text('external_reference'),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    recordedByMembershipId: uuid('recorded_by_membership_id').notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex('payments_clinic_id_uidx').on(table.clinicId, table.id),
    uniqueIndex('payments_clinic_external_uidx')
      .on(table.clinicId, table.externalReference)
      .where(sql`${table.externalReference} is not null`),
    index('payments_patient_idx').on(table.clinicId, table.patientId, table.createdAt),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: 'payments_patient_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.invoiceId, table.currency],
      foreignColumns: [invoices.clinicId, invoices.id, invoices.currency],
      name: 'payments_invoice_currency_tenant_fk',
    }).onDelete('restrict'),
    check('payments_amount_chk', sql`${table.amountMinor} > 0`),
    check('payments_currency_chk', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      'payments_received_chk',
      sql`${table.status} <> 'succeeded' or ${table.receivedAt} is not null`,
    ),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    paymentId: uuid('payment_id').notNull(),
    status: refundStatus('status').default('pending').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    reason: text('reason').notNull(),
    externalReference: text('external_reference'),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    recordedByMembershipId: uuid('recorded_by_membership_id').notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex('refunds_clinic_id_uidx').on(table.clinicId, table.id),
    index('refunds_payment_idx').on(table.clinicId, table.paymentId, table.createdAt),
    foreignKey({
      columns: [table.clinicId, table.paymentId, table.currency],
      foreignColumns: [payments.clinicId, payments.id, payments.currency],
      name: 'refunds_payment_currency_tenant_fk',
    }).onDelete('restrict'),
    check('refunds_amount_chk', sql`${table.amountMinor} > 0`),
    check('refunds_currency_chk', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check('refunds_reason_chk', sql`length(trim(${table.reason})) > 0`),
    check(
      'refunds_completed_chk',
      sql`${table.status} <> 'succeeded' or ${table.refundedAt} is not null`,
    ),
  ],
);
