import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
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
import { clinics, memberships, patients, providers } from './core.js';
import {
  alertSeverity,
  allergyStatus,
  clinicalNoteStatus,
  encounterStatus,
  findingStatus,
  medicationStatus,
  procedureStatus,
  treatmentPlanStatus,
} from './enums.js';
import { appointments } from './scheduling.js';

const createdAt = timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

export const encounters = pgTable(
  'encounters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id').notNull(),
    appointmentId: uuid('appointment_id'),
    providerId: uuid('provider_id').notNull(),
    status: encounterStatus('status').default('open').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    signedByMembershipId: uuid('signed_by_membership_id'),
    createdAt,
  },
  (table) => [
    uniqueIndex('encounters_clinic_id_uidx').on(table.clinicId, table.id),
    uniqueIndex('encounters_clinic_appointment_uidx')
      .on(table.clinicId, table.appointmentId)
      .where(sql`${table.appointmentId} is not null`),
    index('encounters_patient_started_idx').on(table.clinicId, table.patientId, table.startedAt),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: 'encounters_patient_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.appointmentId],
      foreignColumns: [appointments.clinicId, appointments.id],
      name: 'encounters_appointment_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.providerId],
      foreignColumns: [providers.clinicId, providers.id],
      name: 'encounters_provider_tenant_fk',
    }).onDelete('restrict'),
    check(
      'encounters_time_range_chk',
      sql`${table.endedAt} is null or ${table.startedAt} <= ${table.endedAt}`,
    ),
    check(
      'encounters_signature_chk',
      sql`${table.status} = 'open' or (${table.signedAt} is not null and ${table.signedByMembershipId} is not null)`,
    ),
  ],
);

export const clinicalNotes = pgTable(
  'clinical_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id').notNull(),
    encounterId: uuid('encounter_id').notNull(),
    noteGroupId: uuid('note_group_id').notNull(),
    version: integer('version').notNull(),
    supersedesNoteId: uuid('supersedes_note_id'),
    status: clinicalNoteStatus('status').notNull(),
    noteType: text('note_type').notNull(),
    body: text('body').notNull(),
    authoredByMembershipId: uuid('authored_by_membership_id').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    isCurrent: boolean('is_current').default(true).notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex('clinical_notes_clinic_id_uidx').on(table.clinicId, table.id),
    uniqueIndex('clinical_notes_group_version_uidx').on(
      table.clinicId,
      table.noteGroupId,
      table.version,
    ),
    uniqueIndex('clinical_notes_current_uidx')
      .on(table.clinicId, table.noteGroupId)
      .where(sql`${table.isCurrent}`),
    index('clinical_notes_patient_idx').on(table.clinicId, table.patientId, table.createdAt),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: 'clinical_notes_patient_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.encounterId],
      foreignColumns: [encounters.clinicId, encounters.id],
      name: 'clinical_notes_encounter_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.authoredByMembershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
      name: 'clinical_notes_author_tenant_fk',
    }).onDelete('restrict'),
    check('clinical_notes_version_chk', sql`${table.version} >= 1`),
    check('clinical_notes_body_chk', sql`length(trim(${table.body})) > 0`),
    check(
      'clinical_notes_signed_chk',
      sql`${table.status} = 'draft' or ${table.signedAt} is not null`,
    ),
  ],
);

export const medicalAlerts = pgTable(
  'medical_alerts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id').notNull(),
    severity: alertSeverity('severity').notNull(),
    title: text('title').notNull(),
    details: text('details'),
    active: boolean('active').default(true).notNull(),
    recordedByMembershipId: uuid('recorded_by_membership_id').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex('medical_alerts_clinic_id_uidx').on(table.clinicId, table.id),
    index('medical_alerts_patient_active_idx').on(table.clinicId, table.patientId, table.active),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: 'medical_alerts_patient_tenant_fk',
    }).onDelete('restrict'),
    check('medical_alerts_title_chk', sql`length(trim(${table.title})) > 0`),
  ],
);

export const allergies = pgTable(
  'allergies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id').notNull(),
    substance: text('substance').notNull(),
    reaction: text('reaction'),
    severity: text('severity'),
    status: allergyStatus('status').default('active').notNull(),
    onsetDate: date('onset_date'),
    recordedByMembershipId: uuid('recorded_by_membership_id').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('allergies_clinic_id_uidx').on(table.clinicId, table.id),
    index('allergies_patient_status_idx').on(table.clinicId, table.patientId, table.status),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: 'allergies_patient_tenant_fk',
    }).onDelete('restrict'),
    check('allergies_substance_chk', sql`length(trim(${table.substance})) > 0`),
  ],
);

export const medications = pgTable(
  'medications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id').notNull(),
    medicationName: text('medication_name').notNull(),
    dose: text('dose'),
    route: text('route'),
    frequency: text('frequency'),
    status: medicationStatus('status').default('active').notNull(),
    startedOn: date('started_on'),
    endedOn: date('ended_on'),
    recordedByMembershipId: uuid('recorded_by_membership_id').notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex('medications_clinic_id_uidx').on(table.clinicId, table.id),
    index('medications_patient_status_idx').on(table.clinicId, table.patientId, table.status),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: 'medications_patient_tenant_fk',
    }).onDelete('restrict'),
    check('medications_name_chk', sql`length(trim(${table.medicationName})) > 0`),
  ],
);

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
