import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { clinics, locations, operatories, providers, users } from './core.js';
import { appointmentTypes } from './scheduling.js';
export const clinicClosures = pgTable(
  'clinic_closures',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reason: text('reason').notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'clinic_closures_location_tenant_fk',
      columns: [table.clinicId, table.locationId],
      foreignColumns: [locations.clinicId, locations.id],
    }).onDelete('restrict'),
    check('clinic_closures_range_chk', sql`${table.startsAt}<${table.endsAt}`),
    check('clinic_closures_reason_chk', sql`length(trim(${table.reason}))>0`),
    index('clinic_closures_time_idx')
      .on(table.clinicId, table.startsAt, table.endsAt)
      .where(sql`${table.active}`),
  ],
);
export const appointmentSlotOffers = pgTable(
  'appointment_slot_offers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull().unique('appointment_slot_offers_token_hash_unique'),
    locationId: uuid('location_id').notNull(),
    providerId: uuid('provider_id').notNull(),
    operatoryId: uuid('operatory_id').notNull(),
    appointmentTypeId: uuid('appointment_type_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    timezone: text('timezone').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'appointment_slot_offers_location_tenant_fk',
      columns: [table.clinicId, table.locationId],
      foreignColumns: [locations.clinicId, locations.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointment_slot_offers_provider_tenant_fk',
      columns: [table.clinicId, table.providerId],
      foreignColumns: [providers.clinicId, providers.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointment_slot_offers_operatory_location_tenant_fk',
      columns: [table.clinicId, table.operatoryId, table.locationId],
      foreignColumns: [operatories.clinicId, operatories.id, operatories.locationId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointment_slot_offers_type_tenant_fk',
      columns: [table.clinicId, table.appointmentTypeId],
      foreignColumns: [appointmentTypes.clinicId, appointmentTypes.id],
    }).onDelete('restrict'),
    check('appointment_slot_offers_range_chk', sql`${table.startsAt}<${table.endsAt}`),
    check('appointment_slot_offers_timezone_chk', sql`dentalai_timezone_exists(${table.timezone})`),
    index('appointment_slot_offers_expiry_idx').on(table.expiresAt),
    index('appointment_slot_offers_user_idx').on(table.clinicId, table.userId),
  ],
);
