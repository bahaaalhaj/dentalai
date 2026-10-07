import { pgEnum } from 'drizzle-orm/pg-core';

export const membershipStatus = pgEnum('membership_status', [
  'invited',
  'active',
  'suspended',
  'revoked',
]);
export const invitationStatus = pgEnum('invitation_status', [
  'pending',
  'accepted',
  'expired',
  'revoked',
]);
export const staffKind = pgEnum('staff_kind', ['provider', 'staff']);
export const appointmentStatus = pgEnum('appointment_status', [
  'scheduled',
  'confirmed',
  'checked_in',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
]);
export const encounterStatus = pgEnum('encounter_status', ['open', 'signed', 'amended']);
export const clinicalNoteStatus = pgEnum('clinical_note_status', [
  'draft',
  'signed',
  'amended',
  'entered_in_error',
]);
export const alertSeverity = pgEnum('alert_severity', ['info', 'warning', 'critical']);
export const allergyStatus = pgEnum('allergy_status', [
  'active',
  'inactive',
  'resolved',
  'entered_in_error',
]);
export const medicationStatus = pgEnum('medication_status', [
  'active',
  'stopped',
  'completed',
  'entered_in_error',
]);
export const findingStatus = pgEnum('finding_status', [
  'active',
  'resolved',
  'entered_in_error',
]);
export const procedureStatus = pgEnum('procedure_status', [
  'planned',
  'in_progress',
  'completed',
  'cancelled',
  'entered_in_error',
]);
export const treatmentPlanStatus = pgEnum('treatment_plan_status', [
  'draft',
  'presented',
  'accepted',
  'rejected',
  'in_progress',
  'completed',
  'cancelled',
]);
export const fileStatus = pgEnum('file_status', [
  'pending',
  'available',
  'quarantined',
  'deleted',
]);
export const xrayStudyStatus = pgEnum('xray_study_status', [
  'ordered',
  'acquired',
  'reviewed',
  'entered_in_error',
]);
export const aiRunStatus = pgEnum('ai_run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);
export const clinicianReviewStatus = pgEnum('clinician_review_status', [
  'pending',
  'accepted',
  'rejected',
  'needs_revision',
]);
export const anesthesiaApprovalState = pgEnum('anesthesia_approval_state', [
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'superseded',
]);
export const invoiceStatus = pgEnum('invoice_status', [
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'void',
  'uncollectible',
]);
export const paymentStatus = pgEnum('payment_status', [
  'pending',
  'succeeded',
  'failed',
  'voided',
  'partially_refunded',
  'refunded',
]);
export const paymentMethod = pgEnum('payment_method', [
  'cash',
  'card',
  'bank_transfer',
  'insurance',
  'other',
]);
export const refundStatus = pgEnum('refund_status', [
  'pending',
  'succeeded',
  'failed',
  'cancelled',
]);
export const outboxStatus = pgEnum('outbox_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);
