// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { t, setLocale, useLocale } from '../i18n';
import { english, arabic } from '../i18n/messages';
import { generatedEnglish } from '../i18n/generated';
import { LanguageControl } from '../i18n/LanguageControl';
import { OnboardingPage } from '../administration/OnboardingPage';
import { NotificationPreference } from '../administration/NotificationPreference';
import { Odontogram } from '../clinical/Odontogram';
const api = vi.hoisted(() => ({ onboard: vi.fn(), notificationPreferences: vi.fn() }));
vi.mock('../lib/api-client', () => ({ apiClient: api }));
afterEach(() => {
  cleanup();
  setLocale('en');
  vi.resetAllMocks();
});
function Localized() {
  useLocale();
  return (
    <MemoryRouter>
      <LanguageControl />
      <OnboardingPage refresh={async () => undefined} />
    </MemoryRouter>
  );
}
it('maintains English and Arabic administration catalogs without auto-translating clinical entries', () => {
  for (const key of Object.keys(english) as (keyof typeof english)[])
    expect(arabic[key], key).toBeTruthy();
  const clinical = Object.entries(generatedEnglish).find(([, v]) => v === 'Clinical note');
  expect(clinical).toBeDefined();
  setLocale('ar');
  expect(t(clinical![0] as keyof typeof generatedEnglish)).toBe('Clinical note');
  expect(t('admin.title')).toBe('إدارة العيادة');
});
it('switches document language/direction and keeps semantic form values unchanged', () => {
  render(<Localized />);
  expect(screen.getByRole('heading', { name: 'Set up a new clinic' })).toBeTruthy();
  for (const label of [
    'Legal clinic name',
    'Clinic display name',
    'Unique clinic address',
    'First location name',
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value: 'Fictional' } });
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'ar' } });
  expect(document.documentElement.lang).toBe('ar');
  expect(document.documentElement.dir).toBe('rtl');
  expect(screen.getByRole('heading', { name: 'إعداد عيادة جديدة' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: arabic['admin.next'] }));
  const locale = screen.getByLabelText(arabic['admin.locale']!) as HTMLSelectElement;
  expect(locale.value).toBe('en');
  expect((screen.getByLabelText(arabic['admin.currency']!) as HTMLInputElement).value).toBe('SYP');
});
it('shows recoverable preference errors and does not pretend a failed save succeeded', async () => {
  api.notificationPreferences
    .mockResolvedValueOnce({ operationalEmail: true })
    .mockRejectedValueOnce(new Error('Provider offline'));
  render(<NotificationPreference />);
  const input = screen.getByRole('checkbox') as HTMLInputElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  fireEvent.click(input);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Provider offline'));
  expect(input.checked).toBe(true);
});
it('does not mirror the FDI tooth chart in Arabic', () => {
  setLocale('ar');
  render(<Odontogram records={[]} select={() => undefined} />);
  const tooth = screen.getByRole('button', { name: 'Tooth 18: unrecorded' });
  expect(tooth.parentElement?.getAttribute('dir')).toBe('ltr');
});
