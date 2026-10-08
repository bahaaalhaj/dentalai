import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { clinics, locations, memberships, operatories, patients, providers } from './core.js';
import { appointmentStatus } from './enums.js';

const createdAt = timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

export const appointmentTypes = pgTable(
  'appointment_types',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    defaultDurationMinutes: integer('default_duration_minutes').notNull(),
    color: text('color'),
    active: boolean('active').default(true).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('appointment_types_clinic_code_uidx').on(table.clinicId, table.code),
    uniqueIndex('appointment_types_clinic_id_uidx').on(table.clinicId, table.id),
    check(
      'appointment_types_duration_chk',
      sql`${table.defaultDurationMinutes} between 5 and 1440`,
    ),
  ],
);

export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id').notNull(),
    operatoryId: uuid('operatory_id'),
    patientId: uuid('patient_id').notNull(),
    providerId: uuid('provider_id'),
    appointmentTypeId: uuid('appointment_type_id').notNull(),
    status: appointmentStatus('status').default('scheduled').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    timezone: text('timezone').notNull(),
    reason: text('reason'),
    internalNotes: text('internal_notes'),
    createdByMembershipId: uuid('created_by_membership_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByMembershipId: uuid('cancelled_by_membership_id'),
    cancellationReason: text('cancellation_reason'),
    revision: integer('revision').default(0).notNull(),
    lastChangedByMembershipId: uuid('last_changed_by_membership_id'),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('appointments_clinic_id_uidx').on(table.clinicId, table.id),
    uniqueIndex('appointments_clinic_id_patient_uidx').on(
      table.clinicId,
      table.id,
      table.patientId,
    ),
    index('appointments_clinic_start_idx').on(table.clinicId, table.startsAt),
    index('appointments_patient_start_idx').on(table.clinicId, table.patientId, table.startsAt),
    index('appointments_provider_start_idx').on(table.clinicId, table.providerId, table.startsAt),
    foreignKey({
      columns: [table.clinicId, table.locationId],
      foreignColumns: [locations.clinicId, locations.id],
      name: 'appointments_location_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.operatoryId],
      foreignColumns: [operatories.clinicId, operatories.id],
      name: 'appointments_operatory_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: 'appointments_patient_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.providerId],
      foreignColumns: [providers.clinicId, providers.id],
      name: 'appointments_provider_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.appointmentTypeId],
      foreignColumns: [appointmentTypes.clinicId, appointmentTypes.id],
      name: 'appointments_type_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.createdByMembershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
      name: 'appointments_created_by_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.lastChangedByMembershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
      name: 'appointments_last_actor_tenant_fk',
    }).onDelete('restrict'),
    check('appointments_revision_chk', sql`${table.revision} >= 0`),
    check('appointments_time_range_chk', sql`${table.startsAt} < ${table.endsAt}`),
    check('appointments_timezone_chk', sql`length(trim(${table.timezone})) > 0`),
    check(
      'appointments_cancellation_chk',
      sql`(${table.status} not in ('cancelled', 'no_show')) or ${table.cancelledAt} is not null`,
    ),
  ],
);

export const appointmentStatusHistory = pgTable(
  'appointment_status_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    appointmentId: uuid('appointment_id').notNull(),
    fromStatus: appointmentStatus('from_status'),
    toStatus: appointmentStatus('to_status').notNull(),
    reason: text('reason'),
    changedByMembershipId: uuid('changed_by_membership_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('appointment_status_history_timeline_idx').on(
      table.clinicId,
      table.appointmentId,
      table.occurredAt,
    ),
    foreignKey({
      columns: [table.clinicId, table.appointmentId],
      foreignColumns: [appointments.clinicId, appointments.id],
      name: 'appointment_status_history_appointment_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.changedByMembershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
      name: 'appointment_status_history_actor_tenant_fk',
    }).onDelete('restrict'),
    check(
      'appointment_status_history_change_chk',
      sql`${table.fromStatus} is null or ${table.fromStatus} <> ${table.toStatus}`,
    ),
  ],
);

export const scheduleBlocks = pgTable(
  'schedule_blocks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id').notNull(),
    operatoryId: uuid('operatory_id'),
    providerId: uuid('provider_id'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    timezone: text('timezone').notNull(),
    reason: text('reason').notNull(),
    createdByMembershipId: uuid('created_by_membership_id'),
    createdAt,
  },
  (table) => [
    uniqueIndex('schedule_blocks_clinic_id_uidx').on(table.clinicId, table.id),
    index('schedule_blocks_time_idx').on(table.clinicId, table.startsAt, table.endsAt),
    foreignKey({
      columns: [table.clinicId, table.locationId],
      foreignColumns: [locations.clinicId, locations.id],
      name: 'schedule_blocks_location_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.operatoryId],
      foreignColumns: [operatories.clinicId, operatories.id],
      name: 'schedule_blocks_operatory_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.providerId],
      foreignColumns: [providers.clinicId, providers.id],
      name: 'schedule_blocks_provider_tenant_fk',
    }).onDelete('restrict'),
    check('schedule_blocks_time_range_chk', sql`${table.startsAt} < ${table.endsAt}`),
    check(
      'schedule_blocks_resource_chk',
      sql`${table.operatoryId} is not null or ${table.providerId} is not null`,
    ),
  ],
);
