import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  date,
  integer,
  timestamp,
  foreignKey,
  uniqueIndex,
  index,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { clinics, patients, memberships } from './core.js';
import { encounters, treatmentPlanItems } from './clinical.js';

export const clinicalRevisions = pgTable(
  'clinical_revisions',
  {
    id: uuid('id').primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id').notNull(),
    encounterId: uuid('encounter_id').notNull(),
    kind: text('kind').notNull(),
    groupId: uuid('group_id').notNull(),
    version: integer('version').notNull(),
    supersedesId: uuid('supersedes_id'),
    authorMembershipId: uuid('author_membership_id').notNull(),
    reason: text('reason').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (t) => [
    uniqueIndex('clinical_revisions_tenant_identity_uidx').on(
      t.clinicId,
      t.id,
      t.patientId,
      t.groupId,
      t.kind,
    ),
    uniqueIndex('clinical_revisions_clinic_id_uidx').on(t.clinicId, t.id),
    uniqueIndex('clinical_revisions_group_version_uidx').on(t.clinicId, t.groupId, t.version),
    uniqueIndex('clinical_revisions_one_successor_uidx').on(t.clinicId, t.supersedesId),
    index('clinical_revisions_patient_timeline_idx').on(t.clinicId, t.patientId, t.recordedAt),
    foreignKey({
      name: 'clinical_revisions_predecessor_fk',
      columns: [t.clinicId, t.supersedesId, t.patientId, t.groupId, t.kind],
      foreignColumns: [t.clinicId, t.id, t.patientId, t.groupId, t.kind],
    }).onDelete('restrict'),
    foreignKey({
      name: 'clinical_revisions_patient_fk',
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'clinical_revisions_encounter_fk',
      columns: [t.clinicId, t.encounterId, t.patientId],
      foreignColumns: [encounters.clinicId, encounters.id, encounters.patientId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'clinical_revisions_author_fk',
      columns: [t.clinicId, t.authorMembershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }).onDelete('restrict'),
    check(
      'clinical_revisions_kind_chk',
      sql`${t.kind} in ('demographics','note','alert','allergy','medication','finding','procedure','plan')`,
    ),
    check('clinical_revisions_version_chk', sql`${t.version} > 0`),
    check('clinical_revisions_reason_chk', sql`length(trim(${t.reason})) > 0`),
  ],
);
export const clinicalApprovals = pgTable(
  'clinical_approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    revisionId: uuid('revision_id').notNull(),
    decision: text('decision').notNull(),
    reviewerMembershipId: uuid('reviewer_membership_id').notNull(),
    reason: text('reason').notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (t) => [
    uniqueIndex('clinical_approvals_once_uidx').on(t.clinicId, t.revisionId),
    foreignKey({
      name: 'clinical_approvals_revision_fk',
      columns: [t.clinicId, t.revisionId],
      foreignColumns: [clinicalRevisions.clinicId, clinicalRevisions.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'clinical_approvals_reviewer_fk',
      columns: [t.clinicId, t.reviewerMembershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }).onDelete('restrict'),
    check('clinical_approvals_decision_chk', sql`${t.decision} in ('approved','rejected')`),
    check('clinical_approvals_reason_chk', sql`length(trim(${t.reason})) > 0`),
  ],
);
export const clinicalDemographics = pgTable(
  'clinical_demographics',
  {
    id: uuid('id').primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    givenName: text('given_name').notNull(),
    familyName: text('family_name').notNull(),
    preferredName: text('preferred_name'),
    dateOfBirth: date('date_of_birth'),
    phone: text('phone'),
    email: text('email'),
  },
  (t) => [
    foreignKey({
      name: 'clinical_demographics_revision_fk',
      columns: [t.clinicId, t.id],
      foreignColumns: [clinicalRevisions.clinicId, clinicalRevisions.id],
    }).onDelete('restrict'),
    check(
      'clinical_demographics_names_chk',
      sql`length(trim(${t.givenName})) > 0 and length(trim(${t.familyName})) > 0`,
    ),
    check(
      'clinical_demographics_birth_date_chk',
      sql`${t.dateOfBirth} is null or ${t.dateOfBirth} <= current_date`,
    ),
  ],
);
export const clinicalEncounterProvenance = pgTable(
  'clinical_encounter_provenance',
  {
    encounterId: uuid('encounter_id').primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    authorMembershipId: uuid('author_membership_id').notNull(),
    reason: text('reason').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'clinical_encounter_provenance_encounter_fk',
      columns: [t.clinicId, t.encounterId],
      foreignColumns: [encounters.clinicId, encounters.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'clinical_encounter_provenance_author_fk',
      columns: [t.clinicId, t.authorMembershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }).onDelete('restrict'),
    check('clinical_encounter_provenance_reason_chk', sql`length(trim(${t.reason})) > 0`),
  ],
);
export const treatmentPlanItemSurfaces = pgTable(
  'treatment_plan_item_surfaces',
  {
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id').notNull(),
    surfaceCode: text('surface_code').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.clinicId, t.itemId, t.surfaceCode] }),
    foreignKey({
      name: 'treatment_plan_item_surfaces_item_fk',
      columns: [t.clinicId, t.itemId],
      foreignColumns: [treatmentPlanItems.clinicId, treatmentPlanItems.id],
    }).onDelete('restrict'),
    check(
      'treatment_plan_item_surfaces_code_chk',
      sql`${t.surfaceCode} in ('M','D','B','F','L','O','I')`,
    ),
  ],
);
