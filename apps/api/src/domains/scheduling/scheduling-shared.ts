import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { type ClinicRole } from '@dentalai/contracts';
import { type AppointmentState } from '@dentalai/domain';
import type { AccessContext } from '../access/access.repository.js';
import { DomainError } from '../../errors/domain-errors.js';
export type Access = AccessContext & {
  clinicId: string;
  membershipId: string;
  roles: ClinicRole[];
};
export type Queryable = Pool | PoolClient;
export interface Candidate {
  location_id: string;
  provider_id: string;
  operatory_id: string;
  appointment_type_id: string;
  timezone: string;
  duration: number;
}
export interface Offer extends Candidate {
  id: string;
  starts_at: Date;
  ends_at: Date;
}
export interface Row {
  id: string;
  patient_id: string;
  provider_id: string | null;
  appointment_type_id: string;
  status: AppointmentState;
  revision: number;
  starts_at: Date;
  ends_at: Date;
  timezone: string;
  location_name: string;
  provider_name: string | null;
  operatory_name: string | null;
  type_name: string;
  patient_name: string;
}
export interface Hours {
  provider_id: string | null;
  weekday: number;
  opens_at_local: string;
  closes_at_local: string;
  location_id: string;
  valid_from: string | null;
  valid_through: string | null;
}
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export const administrators = ['clinic_owner', 'clinic_admin'] as const;
export const has = (access: Access, roles: readonly ClinicRole[]) =>
  access.roles.some((role) => roles.includes(role));
export const staff = (access: Access) =>
  has(access, ['clinic_owner', 'clinic_admin', 'dentist', 'receptionist']);
export const dentistOnly = (access: Access) =>
  !has(access, ['clinic_owner', 'clinic_admin', 'receptionist']) && has(access, ['dentist']);
export const notFound = () =>
  new DomainError('NOT_FOUND', 'Appointment or resource not found.', 404);
export const denied = () => new DomainError('ACCESS_DENIED', 'Scheduling access denied.', 403);
export const selectRow = `SELECT a.*,l.name AS location_name,u.display_name AS provider_name,o.name AS operatory_name,t.name AS type_name,
 concat_ws(' ',p.given_name,p.family_name) AS patient_name FROM appointments a
 JOIN locations l ON l.id=a.location_id AND l.clinic_id=a.clinic_id JOIN patients p ON p.id=a.patient_id AND p.clinic_id=a.clinic_id
 JOIN appointment_types t ON t.id=a.appointment_type_id AND t.clinic_id=a.clinic_id
 LEFT JOIN operatories o ON o.id=a.operatory_id AND o.clinic_id=a.clinic_id
 LEFT JOIN providers v ON v.id=a.provider_id AND v.clinic_id=a.clinic_id LEFT JOIN staff s ON s.id=v.staff_id AND s.clinic_id=a.clinic_id
 LEFT JOIN memberships m ON m.id=s.membership_id AND m.clinic_id=a.clinic_id LEFT JOIN users u ON u.id=m.user_id`;
