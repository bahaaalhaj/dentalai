import type { z } from 'zod';
import type { ClinicConfigurationSchema } from '@dentalai/contracts';
export type ClinicFieldsValue = z.infer<typeof ClinicConfigurationSchema>;
export const initialClinic: ClinicFieldsValue = {
  legalName: '',
  displayName: '',
  currency: 'SYP',
  timezone: 'Asia/Baghdad',
  locale: 'en',
  contactEmail: null,
  contactPhone: null,
  brandColor: '#4f46e5',
  brandMark: 'DA',
};
