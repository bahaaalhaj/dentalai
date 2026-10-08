import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { clinics, memberships, users } from './core.js';

const instant = (name: string) => timestamp(name, { withTimezone: true });

// Global authentication infrastructure; only a selected clinic context is tenant-owned.
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    token: text('token').notNull().unique(),
    expiresAt: instant('expires_at').notNull(),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    clinicId: uuid('clinic_id').references(() => clinics.id, { onDelete: 'restrict' }),
    activeMembershipId: uuid('active_membership_id'),
  },
  (table) => [
    index('auth_sessions_user_idx').on(table.userId),
    check(
      'auth_sessions_context_chk',
      sql`(${table.clinicId} IS NULL) = (${table.activeMembershipId} IS NULL)`,
    ),
    foreignKey({
      columns: [table.clinicId, table.activeMembershipId, table.userId],
      foreignColumns: [memberships.clinicId, memberships.id, memberships.userId],
      name: 'auth_sessions_membership_tenant_fk',
    }).onDelete('restrict'),
  ],
);

export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: instant('access_token_expires_at'),
    refreshTokenExpiresAt: instant('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (table) => [
    index('auth_accounts_user_idx').on(table.userId),
    unique('auth_accounts_provider_account_unique').on(table.providerId, table.accountId),
  ],
);

export const authVerifications = pgTable(
  'auth_verifications',
  {
    id: uuid('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: instant('expires_at').notNull(),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (table) => [index('auth_verifications_identifier_idx').on(table.identifier)],
);

export const authRateLimits = pgTable('auth_rate_limits', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

export const loginAttempts = pgTable(
  'login_attempts',
  {
    key: text('key').primaryKey(),
    failures: integer('failures').default(0).notNull(),
    windowStartedAt: instant('window_started_at').defaultNow().notNull(),
    blockedUntil: instant('blocked_until'),
  },
  (table) => [check('login_attempts_failures_chk', sql`${table.failures} >= 0`)],
);

export const securityEvents = pgTable(
  'security_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id').references(() => clinics.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    success: boolean('success').notNull(),
    requestId: text('request_id'),
    data: jsonb('data').$type<Record<string, unknown>>().default({}).notNull(),
    occurredAt: instant('occurred_at').defaultNow().notNull(),
  },
  (table) => [
    index('security_events_user_time_idx').on(table.userId, table.occurredAt),
    check('security_events_action_chk', sql`length(trim(${table.action})) > 0`),
  ],
);
