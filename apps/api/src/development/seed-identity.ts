export const developmentId = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const developmentClinicId = developmentId(1);
export const developmentAccounts = [
  { role: 'clinic_owner', user: 21, member: 121, email: 'owner@example.invalid' },
  { role: 'clinic_admin', user: 22, member: 122, email: 'admin@example.invalid' },
  { role: 'dentist', user: 4, member: 6, email: 'dentist@example.invalid' },
  { role: 'receptionist', user: 23, member: 123, email: 'receptionist@example.invalid' },
  { role: 'patient', user: 24, member: 124, email: 'patient@example.invalid' },
  { role: 'dentist', user: 30, member: 130, email: 'dentist2@example.invalid' },
] as const;
export const samplePrices = [
  ['cavity', 50000],
  ['filling', 150000],
  ['extracted', 100000],
  ['root_canal', 450000],
  ['crown', 800000],
  ['implant', 1200000],
] as const;
export const reason = 'Phase 12 synthetic development seed; not patient data';
export type Insert = (table: string, columns: string, values: unknown[]) => Promise<void>;
export type Exists = (table: string, key: string) => Promise<boolean>;
export type Audit = (
  n: number,
  action: string,
  entity: string,
  member: number,
  data: object,
) => Promise<void>;
