import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { invitationStatus, membershipStatus, staffKind } from './enums.js';

const createdAt = timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

export const clinics = pgTable(
  'clinics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),
    slug: text('slug').notNull(),
    defaultTimezone: text('default_timezone').notNull(),
    defaultCurrency: text('default_currency').notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('clinics_slug_uidx').on(table.slug),
    check('clinics_slug_chk', sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    check('clinics_currency_chk', sql`${table.defaultCurrency} ~ '^[A-Z]{3}$'`),
    check('clinics_timezone_chk', sql`length(trim(${table.defaultTimezone})) > 0`),
  ],
);

export const clinicSettings = pgTable('clinic_settings', {
  clinicId: uuid('clinic_id')
    .primaryKey()
    .references(() => clinics.id, { onDelete: 'restrict' }),
  appointmentLeadMinutes: integer('appointment_lead_minutes').default(0).notNull(),
  appointmentHorizonDays: integer('appointment_horizon_days').default(365).notNull(),
  settings: jsonb('settings').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt,
  updatedAt,
});

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    timezone: text('timezone').notNull(),
    addressLine1: text('address_line_1'),
    addressLine2: text('address_line_2'),
    city: text('city'),
    region: text('region'),
    postalCode: text('postal_code'),
    countryCode: text('country_code'),
    phone: text('phone'),
    active: boolean('active').default(true).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('locations_clinic_name_uidx').on(table.clinicId, table.name),
    uniqueIndex('locations_clinic_id_uidx').on(table.clinicId, table.id),
    check('locations_timezone_chk', sql`length(trim(${table.timezone})) > 0`),
  ],
);

export const operatories = pgTable(
  'operatories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id').notNull(),
    name: text('name').notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('operatories_clinic_location_name_uidx').on(
      table.clinicId,
      table.locationId,
      table.name,
    ),
    uniqueIndex('operatories_clinic_id_uidx').on(table.clinicId, table.id),
    foreignKey({
      columns: [table.clinicId, table.locationId],
      foreignColumns: [locations.clinicId, locations.id],
      name: 'operatories_location_tenant_fk',
    }).onDelete('restrict'),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    phone: text('phone'),
    passwordHash: text('password_hash'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex('users_email_lower_uidx').on(sql`lower(${table.email})`)],
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    permissions: jsonb('permissions').$type<string[]>().default([]).notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex('roles_clinic_key_uidx').on(table.clinicId, table.key),
    uniqueIndex('roles_clinic_id_uidx').on(table.clinicId, table.id),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: membershipStatus('status').default('active').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('memberships_clinic_user_uidx').on(table.clinicId, table.userId),
    uniqueIndex('memberships_clinic_id_uidx').on(table.clinicId, table.id),
    index('memberships_user_idx').on(table.userId),
  ],
);

export const membershipRoles = pgTable(
  'membership_roles',
  {
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    membershipId: uuid('membership_id').notNull(),
    roleId: uuid('role_id').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.clinicId, table.membershipId, table.roleId] }),
    foreignKey({
      columns: [table.clinicId, table.membershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
      name: 'membership_roles_membership_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.roleId],
      foreignColumns: [roles.clinicId, roles.id],
      name: 'membership_roles_role_tenant_fk',
    }).onDelete('restrict'),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    email: text('email').notNull(),
    roleId: uuid('role_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    status: invitationStatus('status').default('pending').notNull(),
    invitedByMembershipId: uuid('invited_by_membership_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex('invitations_token_hash_uidx').on(table.tokenHash),
    uniqueIndex('invitations_pending_email_uidx')
      .on(table.clinicId, sql`lower(${table.email})`)
      .where(sql`${table.status} = 'pending'`),
    foreignKey({
      columns: [table.clinicId, table.roleId],
      foreignColumns: [roles.clinicId, roles.id],
      name: 'invitations_role_tenant_fk',
    }).onDelete('restrict'),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id').references(() => clinics.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    createdAt,
  },
  (table) => [
    uniqueIndex('sessions_token_hash_uidx').on(table.tokenHash),
    index('sessions_user_expires_idx').on(table.userId, table.expiresAt),
  ],
);

export const patients = pgTable(
  'patients',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    portalUserId: uuid('portal_user_id').references(() => users.id, { onDelete: 'set null' }),
    medicalRecordNumber: text('medical_record_number').notNull(),
    givenName: text('given_name').notNull(),
    familyName: text('family_name').notNull(),
    preferredName: text('preferred_name'),
    dateOfBirth: date('date_of_birth'),
    phone: text('phone'),
    email: text('email'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('patients_clinic_mrn_uidx').on(table.clinicId, table.medicalRecordNumber),
    uniqueIndex('patients_clinic_id_uidx').on(table.clinicId, table.id),
    uniqueIndex('patients_clinic_portal_user_uidx')
      .on(table.clinicId, table.portalUserId)
      .where(sql`${table.portalUserId} is not null`),
    index('patients_clinic_name_idx').on(table.clinicId, table.familyName, table.givenName),
    check('patients_name_chk', sql`length(trim(${table.givenName})) > 0 and length(trim(${table.familyName})) > 0`),
  ],
);

export const staff = pgTable(
  'staff',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    membershipId: uuid('membership_id').notNull(),
    kind: staffKind('kind').default('staff').notNull(),
    employeeNumber: text('employee_number'),
    title: text('title'),
    active: boolean('active').default(true).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('staff_clinic_membership_uidx').on(table.clinicId, table.membershipId),
    uniqueIndex('staff_clinic_id_uidx').on(table.clinicId, table.id),
    foreignKey({
      columns: [table.clinicId, table.membershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
      name: 'staff_membership_tenant_fk',
    }).onDelete('restrict'),
  ],
);

export const providers = pgTable(
  'providers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    staffId: uuid('staff_id').notNull(),
    providerType: text('provider_type').notNull(),
    licenseNumber: text('license_number'),
    licenseRegion: text('license_region'),
    active: boolean('active').default(true).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('providers_clinic_staff_uidx').on(table.clinicId, table.staffId),
    uniqueIndex('providers_clinic_id_uidx').on(table.clinicId, table.id),
    foreignKey({
      columns: [table.clinicId, table.staffId],
      foreignColumns: [staff.clinicId, staff.id],
      name: 'providers_staff_tenant_fk',
    }).onDelete('restrict'),
  ],
);

export const workingHours = pgTable(
  'working_hours',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id').notNull(),
    providerId: uuid('provider_id'),
    weekday: integer('weekday').notNull(),
    opensAtLocal: time('opens_at_local').notNull(),
    closesAtLocal: time('closes_at_local').notNull(),
    validFrom: date('valid_from'),
    validThrough: date('valid_through'),
    createdAt,
  },
  (table) => [
    index('working_hours_schedule_idx').on(
      table.clinicId,
      table.locationId,
      table.providerId,
      table.weekday,
    ),
    foreignKey({
      columns: [table.clinicId, table.locationId],
      foreignColumns: [locations.clinicId, locations.id],
      name: 'working_hours_location_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.providerId],
      foreignColumns: [providers.clinicId, providers.id],
      name: 'working_hours_provider_tenant_fk',
    }).onDelete('restrict'),
    check('working_hours_weekday_chk', sql`${table.weekday} between 0 and 6`),
    check('working_hours_range_chk', sql`${table.opensAtLocal} < ${table.closesAtLocal}`),
  ],
);
