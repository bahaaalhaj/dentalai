// Keep Temporal and location-aware formatting inside the scheduling route chunk.
import { formatAppointmentTime as formatInZone } from '@dentalai/domain';
import { currentLocale } from './i18n';
export const formatAppointmentTime = (instant: string, zone: string) =>
  formatInZone(instant, zone, currentLocale() === 'ar' ? 'ar' : 'en-GB');
