import { afterEach, expect, it } from 'vitest';
import { setLocale, t } from '../i18n';
import { displayStatus, formatInstant } from '../i18n/display';
import { formatAppointmentTime } from '../appointment-format';
import { ApiClientError } from '../lib/api-client';
import { getErrorMessage } from '../lib/errors';
afterEach(() => setLocale('en'));
it('formats dates and days in the selected language while preserving location timezone', () => {
  const instant = '2026-01-05T09:00:00Z';
  const englishDate = formatInstant(instant),
    englishAppointment = formatAppointmentTime(instant, 'Asia/Baghdad');
  expect(englishAppointment).toContain('12:00');
  setLocale('ar');
  expect(formatInstant(instant)).not.toBe(englishDate);
  expect(formatAppointmentTime(instant, 'Asia/Baghdad')).not.toBe(englishAppointment);
  expect(t('weekday.1')).toBe('الإثنين');
});
it('localizes ordinary states and safe errors, never rewrites clinical codes', () => {
  setLocale('ar');
  expect(displayStatus('confirmed')).toBe('مؤكد');
  expect(displayStatus('cash')).toBe('نقداً');
  expect(displayStatus('trial')).toBe('فترة تجريبية');
  expect(displayStatus('queued')).toBe('في قائمة الانتظار');
  expect(displayStatus('book')).toBe(t('ui.eefda2bfa8623a6a'));
  expect(t('fallback.noProvider')).toContain('طبيب أسنان');
  expect(displayStatus('root_canal')).toBe('root_canal');
  expect(
    getErrorMessage(
      new ApiClientError(409, {
        error: { code: 'CONFLICT', message: 'private backend detail', requestId: 'test' },
      }),
    ),
  ).toBe(t('error.conflict'));
  expect(getErrorMessage(new Error('private debug detail'))).toBe(t('error.generic'));
  expect(t('availability.count', { count: 3 })).toContain('3');
});
it('makes no current reminder or treatment guarantee claim', () => {
  expect(t('landing.schedulingDescription')).toContain('not available');
  expect(t('landing.examples')).toContain('no partnership or treatment guarantee');
});
