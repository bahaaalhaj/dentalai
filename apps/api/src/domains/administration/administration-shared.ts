import { DomainError } from '../../errors/domain-errors.js';
export const denied = () =>
  new DomainError('ACCESS_DENIED', 'Clinic administration access denied.', 403);
export const missing = () =>
  new DomainError('NOT_FOUND', 'Administration resource not found.', 404);
export const conflict = () =>
  new DomainError(
    'ADMINISTRATION_CONFLICT',
    'Configuration changed. Refresh before retrying.',
    409,
  );
export const iso = (value: Date | null) => value?.toISOString() ?? null;
export type Admin = { clinic: string; member: string; owner: boolean };
