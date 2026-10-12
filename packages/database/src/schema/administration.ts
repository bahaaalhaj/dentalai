import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  uuid,
  timestamp,
  jsonb,
  foreignKey,
  check,
  index,
  unique,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { clinics, memberships, users, invitations } from './core.js';
const instant = (name: string) => timestamp(name, { withTimezone: true });
export const saasPlans = pgTable(
  'saas_plans',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    version: integer('version').default(1).notNull(),
    seats: integer('seats').notNull(),
    locations: integer('locations').notNull(),
    appointmentsPerMonth: integer('appointments_per_month').notNull(),
    storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull(),
    public: boolean('public').default(true).notNull(),
  },
  (t) => [
    check('saas_plans_version_check', sql`${t.version}>0`),
    check('saas_plans_seats_check', sql`${t.seats}>0`),
    check('saas_plans_locations_check', sql`${t.locations}>0`),
    check('saas_plans_appointments_per_month_check', sql`${t.appointmentsPerMonth}>0`),
    check('saas_plans_storage_bytes_check', sql`${t.storageBytes}>0`),
  ],
);
export const clinicProfiles = pgTable(
  'clinic_profiles',
  {
    clinicId: uuid('clinic_id')
      .primaryKey()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    locale: text('locale').default('en').notNull(),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    brandColor: text('brand_color').default('#4f46e5').notNull(),
    brandMark: text('brand_mark').default('DA').notNull(),
    version: integer('version').default(1).notNull(),
    updatedAt: instant('updated_at').defaultNow().notNull(),
  },
  (t) => [
    check('clinic_profiles_locale_check', sql`${t.locale} IN ('en','ar')`),
    check('clinic_profiles_brand_color_check', sql`${t.brandColor} ~ '^#[0-9a-fA-F]{6}$'`),
    check('clinic_profiles_brand_mark_check', sql`length(${t.brandMark}) BETWEEN 1 AND 8`),
    check('clinic_profiles_version_check', sql`${t.version}>0`),
  ],
);
export const clinicSubscriptions = pgTable(
  'clinic_subscriptions',
  {
    clinicId: uuid('clinic_id')
      .primaryKey()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    planCode: text('plan_code')
      .notNull()
      .references(() => saasPlans.code, { onDelete: 'restrict' }),
    provider: text('provider').default('administrative-mock').notNull(),
    state: text('state').notNull(),
    periodEnd: instant('period_end'),
    graceEnd: instant('grace_end'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
    requestedPlan: text('requested_plan').references(() => saasPlans.code, {
      onDelete: 'restrict',
    }),
    version: integer('version').default(1).notNull(),
    updatedAt: instant('updated_at').defaultNow().notNull(),
  },
  (t) => [
    check('clinic_subscriptions_provider_check', sql`${t.provider}='administrative-mock'`),
    check(
      'clinic_subscriptions_state_check',
      sql`${t.state} IN ('trial','active','past_due','suspended','cancelled')`,
    ),
    check('clinic_subscriptions_version_check', sql`${t.version}>0`),
    check(
      'clinic_subscriptions_check',
      sql`${t.state} NOT IN ('trial','past_due') OR ${t.periodEnd} IS NOT NULL`,
    ),
    check(
      'clinic_subscriptions_check1',
      sql`${t.graceEnd} IS NULL OR (${t.periodEnd} IS NOT NULL AND ${t.graceEnd}>=${t.periodEnd})`,
    ),
  ],
);
export const subscriptionEvents = pgTable(
  'subscription_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    reason: text('reason').notNull(),
    beforeData: jsonb('before_data').$type<Record<string, unknown>>(),
    afterData: jsonb('after_data').$type<Record<string, unknown>>().notNull(),
    occurredAt: instant('occurred_at').defaultNow().notNull(),
  },
  (t) => [
    index('subscription_events_clinic_time_idx').on(t.clinicId, t.occurredAt),
    check('subscription_events_reason_check', sql`length(trim(${t.reason}))>0`),
  ],
);
export const clinicExports = pgTable(
  'clinic_exports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    requestedBy: uuid('requested_by').notNull(),
    createdAt: instant('created_at').defaultNow().notNull(),
    reason: text('reason').notNull(),
    manifest: jsonb('manifest').$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    unique('clinic_exports_clinic_id_id_key').on(t.clinicId, t.id),
    check('clinic_exports_reason_check', sql`length(trim(${t.reason}))>0`),
    foreignKey({
      columns: [t.clinicId, t.requestedBy],
      foreignColumns: [memberships.clinicId, memberships.id],
    }).onDelete('restrict'),
  ],
);
export const clinicOffboarding = pgTable(
  'clinic_offboarding',
  {
    clinicId: uuid('clinic_id')
      .primaryKey()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    requestedBy: uuid('requested_by').notNull(),
    reason: text('reason').notNull(),
    requestedAt: instant('requested_at').defaultNow().notNull(),
    completedAt: instant('completed_at'),
    exportId: uuid('export_id'),
  },
  (t) => [
    check('clinic_offboarding_reason_check', sql`length(trim(${t.reason}))>0`),
    check('clinic_offboarding_check', sql`${t.completedAt} IS NULL OR ${t.exportId} IS NOT NULL`),
    foreignKey({
      columns: [t.clinicId, t.requestedBy],
      foreignColumns: [memberships.clinicId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.clinicId, t.exportId],
      foreignColumns: [clinicExports.clinicId, clinicExports.id],
    }).onDelete('restrict'),
  ],
);
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    membershipId: uuid('membership_id').notNull(),
    operationalEmail: boolean('operational_email').default(true).notNull(),
    updatedAt: instant('updated_at').defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.clinicId, t.membershipId] }),
    foreignKey({
      columns: [t.clinicId, t.membershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }).onDelete('restrict'),
  ],
);
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    recipient: text('recipient').notNull(),
    membershipId: uuid('membership_id'),
    category: text('category').notNull(),
    encryptedMessage: text('encrypted_message').notNull(),
    state: text('state').default('queued').notNull(),
    provider: text('provider'),
    providerReference: text('provider_reference'),
    attempts: integer('attempts').default(0).notNull(),
    errorCode: text('error_code'),
    createdAt: instant('created_at').defaultNow().notNull(),
    acceptedAt: instant('accepted_at'),
    invitationId: uuid('invitation_id'),
  },
  (t) => [
    unique('notification_deliveries_clinic_id_id_key').on(t.clinicId, t.id),
    check(
      'notification_deliveries_category_check',
      sql`${t.category} IN ('invitation','operational')`,
    ),
    check(
      'notification_deliveries_state_check',
      sql`${t.state} IN ('queued','accepted','failed','skipped')`,
    ),
    check('notification_deliveries_attempts_check', sql`${t.attempts}>=0`),
    foreignKey({
      columns: [t.clinicId, t.invitationId],
      foreignColumns: [invitations.clinicId, invitations.id],
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.clinicId, t.membershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }).onDelete('restrict'),
    index('notification_deliveries_clinic_time_idx').on(t.clinicId, t.createdAt),
  ],
);
