import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { encounters } from './clinical.js';
import { clinics, memberships, patients, providers } from './core.js';
import {
  aiRunStatus,
  anesthesiaApprovalState,
  clinicianReviewStatus,
  fileStatus,
  xrayStudyStatus,
} from './enums.js';

const createdAt = timestamp('created_at', { withTimezone: true }).defaultNow().notNull();

export const files = pgTable(
  'files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id'),
    storageProvider: text('storage_provider').notNull(),
    bucket: text('bucket').notNull(),
    objectKey: text('object_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    sha256: text('sha256').notNull(),
    status: fileStatus('status').default('pending').notNull(),
    uploadedByMembershipId: uuid('uploaded_by_membership_id').notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex('files_clinic_id_uidx').on(table.clinicId, table.id),
    uniqueIndex('files_storage_object_uidx').on(
      table.clinicId,
      table.storageProvider,
      table.bucket,
      table.objectKey,
    ),
    index('files_patient_idx').on(table.clinicId, table.patientId, table.createdAt),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: 'files_patient_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.uploadedByMembershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
      name: 'files_uploader_tenant_fk',
    }).onDelete('restrict'),
    check('files_size_chk', sql`${table.sizeBytes} >= 0`),
    check('files_sha256_chk', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'files_availability_chk',
      sql`${table.status} <> 'available' or ${table.availableAt} is not null`,
    ),
  ],
);

export const xrayStudies = pgTable(
  'xray_studies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id').notNull(),
    encounterId: uuid('encounter_id'),
    orderedByProviderId: uuid('ordered_by_provider_id'),
    studyType: text('study_type').notNull(),
    status: xrayStudyStatus('status').default('ordered').notNull(),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt,
  },
  (table) => [
    uniqueIndex('xray_studies_clinic_id_uidx').on(table.clinicId, table.id),
    index('xray_studies_patient_idx').on(table.clinicId, table.patientId, table.createdAt),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: 'xray_studies_patient_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.encounterId],
      foreignColumns: [encounters.clinicId, encounters.id],
      name: 'xray_studies_encounter_tenant_fk',
    }).onDelete('restrict'),
    check(
      'xray_studies_acquired_chk',
      sql`${table.status} = 'ordered' or ${table.acquiredAt} is not null`,
    ),
  ],
);

export const xrayStudyFiles = pgTable(
  'xray_study_files',
  {
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    xrayStudyId: uuid('xray_study_id').notNull(),
    fileId: uuid('file_id').notNull(),
    sequence: integer('sequence').default(1).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.clinicId, table.xrayStudyId, table.fileId] }),
    uniqueIndex('xray_study_files_sequence_uidx').on(
      table.clinicId,
      table.xrayStudyId,
      table.sequence,
    ),
    foreignKey({
      columns: [table.clinicId, table.xrayStudyId],
      foreignColumns: [xrayStudies.clinicId, xrayStudies.id],
      name: 'xray_study_files_study_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.fileId],
      foreignColumns: [files.clinicId, files.id],
      name: 'xray_study_files_file_tenant_fk',
    }).onDelete('restrict'),
  ],
);

export const aiAnalysisRuns = pgTable(
  'ai_analysis_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id').notNull(),
    xrayStudyId: uuid('xray_study_id').notNull(),
    status: aiRunStatus('status').default('queued').notNull(),
    modelName: text('model_name'),
    modelVersion: text('model_version'),
    inputManifest: jsonb('input_manifest').$type<Record<string, unknown>>().notNull(),
    resultFileId: uuid('result_file_id'),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    reviewStatus: clinicianReviewStatus('review_status').default('pending').notNull(),
    requestedByMembershipId: uuid('requested_by_membership_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex('ai_analysis_runs_clinic_id_uidx').on(table.clinicId, table.id),
    index('ai_analysis_runs_study_idx').on(table.clinicId, table.xrayStudyId, table.createdAt),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: 'ai_analysis_runs_patient_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.xrayStudyId],
      foreignColumns: [xrayStudies.clinicId, xrayStudies.id],
      name: 'ai_analysis_runs_study_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.resultFileId],
      foreignColumns: [files.clinicId, files.id],
      name: 'ai_analysis_runs_result_file_tenant_fk',
    }).onDelete('restrict'),
    check(
      'ai_analysis_runs_success_chk',
      sql`${table.status} <> 'succeeded' or (${table.modelName} is not null and ${table.modelVersion} is not null and ${table.resultFileId} is not null and ${table.completedAt} is not null)`,
    ),
    check(
      'ai_analysis_runs_failure_chk',
      sql`${table.status} <> 'failed' or (${table.failureCode} is not null and ${table.completedAt} is not null)`,
    ),
  ],
);

export const aiAnalysisReviews = pgTable(
  'ai_analysis_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    aiAnalysisRunId: uuid('ai_analysis_run_id').notNull(),
    reviewStatus: clinicianReviewStatus('review_status').notNull(),
    reviewedByProviderId: uuid('reviewed_by_provider_id').notNull(),
    comment: text('comment'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('ai_analysis_reviews_run_idx').on(
      table.clinicId,
      table.aiAnalysisRunId,
      table.reviewedAt,
    ),
    foreignKey({
      columns: [table.clinicId, table.aiAnalysisRunId],
      foreignColumns: [aiAnalysisRuns.clinicId, aiAnalysisRuns.id],
      name: 'ai_analysis_reviews_run_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.reviewedByProviderId],
      foreignColumns: [providers.clinicId, providers.id],
      name: 'ai_analysis_reviews_provider_tenant_fk',
    }).onDelete('restrict'),
  ],
);

export const anesthesiaAssessments = pgTable(
  'anesthesia_assessments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id').notNull(),
    encounterId: uuid('encounter_id'),
    providerId: uuid('provider_id').notNull(),
    version: integer('version').default(1).notNull(),
    supersedesAssessmentId: uuid('supersedes_assessment_id'),
    ruleSetVersion: text('rule_set_version').notNull(),
    inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull(),
    modeledOutput: jsonb('modeled_output').$type<Record<string, unknown>>(),
    approvalState: anesthesiaApprovalState('approval_state').default('draft').notNull(),
    approvedByProviderId: uuid('approved_by_provider_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex('anesthesia_assessments_clinic_id_uidx').on(table.clinicId, table.id),
    index('anesthesia_assessments_patient_idx').on(
      table.clinicId,
      table.patientId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: 'anesthesia_assessments_patient_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.clinicId, table.providerId],
      foreignColumns: [providers.clinicId, providers.id],
      name: 'anesthesia_assessments_provider_tenant_fk',
    }).onDelete('restrict'),
    check('anesthesia_assessments_version_chk', sql`${table.version} >= 1`),
    check('anesthesia_assessments_ruleset_chk', sql`length(trim(${table.ruleSetVersion})) > 0`),
    check(
      'anesthesia_assessments_approval_chk',
      sql`${table.approvalState} <> 'approved' or (${table.approvedByProviderId} is not null and ${table.approvedAt} is not null and ${table.modeledOutput} is not null)`,
    ),
  ],
);
