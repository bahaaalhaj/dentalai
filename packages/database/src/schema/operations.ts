import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { clinics, memberships, users } from './core.js';
import { outboxStatus } from './enums.js';

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    actorMembershipId: uuid('actor_membership_id').references(() => memberships.id, {
      onDelete: 'restrict',
    }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    requestId: text('request_id'),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().default({}).notNull(),
  },
  (table) => [
    index('audit_events_entity_idx').on(
      table.clinicId,
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
    index('audit_events_actor_idx').on(table.clinicId, table.actorUserId, table.occurredAt),
    check('audit_events_action_chk', sql`length(trim(${table.action})) > 0`),
    check('audit_events_entity_type_chk', sql`length(trim(${table.entityType})) > 0`),
  ],
);

export const outboxJobs = pgTable(
  'outbox_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    topic: text('topic').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: outboxStatus('status').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('outbox_jobs_clinic_idempotency_uidx').on(table.clinicId, table.idempotencyKey),
    index('outbox_jobs_pending_idx')
      .on(table.availableAt, table.createdAt)
      .where(sql`${table.status} in ('pending', 'failed')`),
    check('outbox_jobs_attempts_chk', sql`${table.attempts} >= 0`),
    check('outbox_jobs_topic_chk', sql`length(trim(${table.topic})) > 0`),
  ],
);
