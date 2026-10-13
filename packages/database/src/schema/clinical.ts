import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { clinics, patients, providers } from './core.js';
import { findingStatus, procedureStatus, treatmentPlanStatus } from './enums.js';
import { encounters, createdAt, updatedAt } from './clinical-history.js';
export const odontogramFindings = pgTable(
  'odontogram_findings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id').notNull(),
    encounterId: uuid('encounter_id'),
    toothCode: text('tooth_code').notNull(),
    dentition: text('dentition').notNull(),
    findingCode: text('finding_code').notNull(),
    status: findingStatus('status').default('active').notNull(),
    details: text('details'),
    recordedByMembershipId: uuid('recorded_by_membership_id').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('odontogram_findings_clinic_id_uidx').on(table.clinicId, table.id),
    foreignKey({
      columns: [table.clinicId, table.encounterId, table.patientId],
      foreignColumns: [encounters.clinicId, encounters.id, encounters.patientId],
      name: 'odontogram_findings_encounter_patient_fk',
    }).onDelete('restrict'),
    index('odontogram_findings_patient_tooth_idx').on(
      table.clinicId,
      table.patientId,
      table.toothCode,
    ),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: 'odontogram_findings_patient_tenant_fk',
    }).onDelete('restrict'),
    check('odontogram_findings_tooth_chk', sql`length(trim(${table.toothCode})) > 0`),
    check('odontogram_findings_dentition_chk', sql`${table.dentition} in ('primary', 'permanent')`),
  ],
);
export const odontogramFindingSurfaces = pgTable(
  'odontogram_finding_surfaces',
  {
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    findingId: uuid('finding_id').notNull(),
    surfaceCode: text('surface_code').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.clinicId, table.findingId, table.surfaceCode] }),
    foreignKey({
      columns: [table.clinicId, table.findingId],
      foreignColumns: [odontogramFindings.clinicId, odontogramFindings.id],
      name: 'odontogram_finding_surfaces_finding_tenant_fk',
    }).onDelete('restrict'),
    check(
      'odontogram_finding_surfaces_code_chk',
      sql`${table.surfaceCode} in ('M', 'O', 'D', 'B', 'L', 'I', 'F')`,
    ),
  ],
);
export const procedures = pgTable(
  'procedures',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id').notNull(),
    encounterId: uuid('encounter_id'),
    providerId: uuid('provider_id').notNull(),
    serviceId: uuid('service_id'),
    toothCode: text('tooth_code'),
    dentition: text('dentition'),
    procedureCode: text('procedure_code').notNull(),
    description: text('description').notNull(),
    status: procedureStatus('status').default('planned').notNull(),
    performedAt: timestamp('performed_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('procedures_clinic_id_uidx').on(table.clinicId, table.id),
    foreignKey({
      columns: [table.clinicId, table.encounterId, table.patientId],
      foreignColumns: [encounters.clinicId, encounters.id, encounters.patientId],
      name: 'procedures_encounter_patient_fk',
    }).onDelete('restrict'),
    index('procedures_patient_idx').on(table.clinicId, table.patientId, table.createdAt),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: 'procedures_patient_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.providerId],
      foreignColumns: [providers.clinicId, providers.id],
      name: 'procedures_provider_tenant_fk',
    }).onDelete('restrict'),
    check(
      'procedures_dentition_chk',
      sql`${table.dentition} is null or ${table.dentition} in ('primary', 'permanent')`,
    ),
    check(
      'procedures_completion_chk',
      sql`${table.status} <> 'completed' or ${table.performedAt} is not null`,
    ),
  ],
);
export const procedureSurfaces = pgTable(
  'procedure_surfaces',
  {
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    procedureId: uuid('procedure_id').notNull(),
    surfaceCode: text('surface_code').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.clinicId, table.procedureId, table.surfaceCode] }),
    foreignKey({
      columns: [table.clinicId, table.procedureId],
      foreignColumns: [procedures.clinicId, procedures.id],
      name: 'procedure_surfaces_procedure_tenant_fk',
    }).onDelete('restrict'),
    check(
      'procedure_surfaces_code_chk',
      sql`${table.surfaceCode} in ('M', 'O', 'D', 'B', 'L', 'I', 'F')`,
    ),
  ],
);
export const procedureStatusHistory = pgTable(
  'procedure_status_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    procedureId: uuid('procedure_id').notNull(),
    fromStatus: procedureStatus('from_status'),
    toStatus: procedureStatus('to_status').notNull(),
    changedByMembershipId: uuid('changed_by_membership_id').notNull(),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('procedure_status_history_timeline_idx').on(
      table.clinicId,
      table.procedureId,
      table.occurredAt,
    ),
    foreignKey({
      columns: [table.clinicId, table.procedureId],
      foreignColumns: [procedures.clinicId, procedures.id],
      name: 'procedure_status_history_procedure_tenant_fk',
    }).onDelete('restrict'),
  ],
);
export const treatmentPlans = pgTable(
  'treatment_plans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id').notNull(),
    providerId: uuid('provider_id').notNull(),
    name: text('name').notNull(),
    version: integer('version').default(1).notNull(),
    status: treatmentPlanStatus('status').default('draft').notNull(),
    supersedesPlanId: uuid('supersedes_plan_id'),
    presentedAt: timestamp('presented_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('treatment_plans_clinic_id_uidx').on(table.clinicId, table.id),
    index('treatment_plans_patient_idx').on(table.clinicId, table.patientId, table.createdAt),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: 'treatment_plans_patient_tenant_fk',
    }).onDelete('restrict'),
    check('treatment_plans_version_chk', sql`${table.version} >= 1`),
  ],
);
export const treatmentPlanItems = pgTable(
  'treatment_plan_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    treatmentPlanId: uuid('treatment_plan_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    sequence: integer('sequence').notNull(),
    toothCode: text('tooth_code'),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).default('1').notNull(),
    estimatedAmountMinor: integer('estimated_amount_minor').notNull(),
    currency: text('currency').notNull(),
    status: procedureStatus('status').default('planned').notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex('treatment_plan_items_plan_sequence_uidx').on(
      table.clinicId,
      table.treatmentPlanId,
      table.sequence,
    ),
    uniqueIndex('treatment_plan_items_clinic_id_uidx').on(table.clinicId, table.id),
    foreignKey({
      columns: [table.clinicId, table.treatmentPlanId],
      foreignColumns: [treatmentPlans.clinicId, treatmentPlans.id],
      name: 'treatment_plan_items_plan_tenant_fk',
    }).onDelete('restrict'),
    check('treatment_plan_items_sequence_chk', sql`${table.sequence} >= 1`),
    check('treatment_plan_items_quantity_chk', sql`${table.quantity} > 0`),
    check('treatment_plan_items_money_chk', sql`${table.estimatedAmountMinor} >= 0`),
    check('treatment_plan_items_currency_chk', sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);
export {
  encounters,
  clinicalNotes,
  medicalAlerts,
  allergies,
  medications,
} from './clinical-history.js';
