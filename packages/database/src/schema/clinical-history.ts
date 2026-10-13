import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
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
  medicationStatus,
} from './enums.js';
import { appointments } from './scheduling.js';

export const createdAt = timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
export const updatedAt = timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();
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
    uniqueIndex('encounters_clinic_id_patient_uidx').on(table.clinicId, table.id, table.patientId),
    foreignKey({
      columns: [table.clinicId, table.appointmentId, table.patientId],
      foreignColumns: [appointments.clinicId, appointments.id, appointments.patientId],
      name: 'encounters_appointment_patient_fk',
    }).onDelete('restrict'),
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
    foreignKey({
      columns: [table.clinicId, table.encounterId, table.patientId],
      foreignColumns: [encounters.clinicId, encounters.id, encounters.patientId],
      name: 'clinical_notes_encounter_patient_fk',
    }).onDelete('restrict'),
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
