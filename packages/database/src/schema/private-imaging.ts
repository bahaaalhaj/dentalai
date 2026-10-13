import { sql } from 'drizzle-orm';
import {
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  doublePrecision,
} from 'drizzle-orm/pg-core';
import { clinics, memberships, patients, users } from './core.js';
import { files, xrayStudies } from './imaging.js';
const created = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
export const clinicalImageVersions = pgTable(
  'clinical_image_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id').notNull(),
    studyId: uuid('study_id').notNull(),
    fileId: uuid('file_id').notNull(),
    version: integer('version').notNull(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    sourceSha256: text('source_sha256').notNull(),
    reason: text('reason').notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('clinical_image_versions_clinic_id_id_key').on(t.clinicId, t.id),
    uniqueIndex('clinical_image_versions_clinic_id_study_id_version_key').on(
      t.clinicId,
      t.studyId,
      t.version,
    ),
    uniqueIndex('clinical_image_versions_clinic_id_file_id_key').on(t.clinicId, t.fileId),
    foreignKey({
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.clinicId, t.studyId, t.patientId],
      foreignColumns: [xrayStudies.clinicId, xrayStudies.id, xrayStudies.patientId],
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.clinicId, t.fileId, t.patientId],
      foreignColumns: [files.clinicId, files.id, files.patientId],
    }).onDelete('restrict'),
  ],
);
export const imageInferenceRuns = pgTable(
  'image_inference_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    imageId: uuid('image_id').notNull(),
    requestedByMembershipId: uuid('requested_by_membership_id').notNull(),
    reason: text('reason').notNull(),
    status: text('status').default('running').notNull(),
    result: jsonb('result'),
    errorCode: text('error_code'),
    createdAt: created(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true })
      .default(sql`now()+interval '2 minutes'`)
      .notNull(),
  },
  (t) => [
    uniqueIndex('image_inference_runs_clinic_id_id_key').on(t.clinicId, t.id),
    foreignKey({
      columns: [t.clinicId, t.imageId],
      foreignColumns: [clinicalImageVersions.clinicId, clinicalImageVersions.id],
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.clinicId, t.requestedByMembershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }).onDelete('restrict'),
  ],
);
export const imageModelDetections = pgTable(
  'image_model_detections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id').notNull(),
    runId: uuid('run_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    classId: integer('class_id').notNull(),
    className: text('class_name').notNull(),
    score: doublePrecision('score').notNull(),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    width: doublePrecision('width').notNull(),
    height: doublePrecision('height').notNull(),
  },
  (t) => [
    uniqueIndex('image_model_detections_clinic_id_run_id_ordinal_key').on(
      t.clinicId,
      t.runId,
      t.ordinal,
    ),
    foreignKey({
      columns: [t.clinicId, t.runId],
      foreignColumns: [imageInferenceRuns.clinicId, imageInferenceRuns.id],
    }).onDelete('restrict'),
  ],
);
export const imageClinicianReviews = pgTable(
  'image_clinician_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id').notNull(),
    runId: uuid('run_id').notNull(),
    decision: text('decision').notNull(),
    authorMembershipId: uuid('author_membership_id').notNull(),
    reason: text('reason').notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('image_clinician_reviews_clinic_id_run_id_key').on(t.clinicId, t.runId),
    foreignKey({
      columns: [t.clinicId, t.runId],
      foreignColumns: [imageInferenceRuns.clinicId, imageInferenceRuns.id],
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.clinicId, t.authorMembershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }).onDelete('restrict'),
  ],
);
