import { type ClinicalContent } from '@dentalai/contracts';
import { DomainError } from '../../errors/domain-errors.js';
export type Access = {
  clinicId: string;
  membershipId: string;
  providerId: string | null;
  patientRole: boolean;
};
export type Header = {
  id: string;
  patient_id: string;
  encounter_id: string;
  kind: ClinicalContent['kind'];
  group_id: string;
  version: number;
  author_name: string;
  reason: string;
  recorded_at: Date;
  decision: 'approved' | 'rejected' | null;
  reviewed_at: Date | null;
  review_reason: string | null;
};
export const denied = () => new DomainError('ACCESS_DENIED', 'Clinical access denied.', 403);
export const missing = () =>
  new DomainError('NOT_FOUND', 'Clinical record or patient not found.', 404);
export const conflict = () =>
  new DomainError(
    'CLINICAL_CONFLICT',
    'The record changed or this encounter is closed. Refresh before retrying.',
    409,
  );
export const tables = {
  demographics: 'clinical_demographics',
  note: 'clinical_notes',
  alert: 'medical_alerts',
  allergy: 'allergies',
  medication: 'medications',
  finding: 'odontogram_findings',
  procedure: 'procedures',
  plan: 'treatment_plans',
} as const;
