import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, unique, foreignKey } from 'drizzle-orm/pg-core';
import { clinics, users, patients } from './core.js';
import { clinicalImageVersions, imageInferenceRuns } from './private-imaging.js';
export const imagingOperations = pgTable(
  'imaging_operations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    requestKey: uuid('request_key').notNull(),
    kind: text('kind').notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id').notNull(),
    requestSha256: text('request_sha256').notNull(),
    imageId: uuid('image_id'),
    runId: uuid('run_id'),
    state: text('state').default('pending').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true })
      .default(sql`now()+interval '2 minutes'`)
      .notNull(),
  },
  (t) => [
    unique('imaging_operations_clinic_id_request_key_key').on(t.clinicId, t.requestKey),
    unique('imaging_operations_clinic_id_id_key').on(t.clinicId, t.id),
    foreignKey({
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.clinicId, t.imageId],
      foreignColumns: [clinicalImageVersions.clinicId, clinicalImageVersions.id],
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.clinicId, t.runId],
      foreignColumns: [imageInferenceRuns.clinicId, imageInferenceRuns.id],
    }).onDelete('restrict'),
  ],
);
