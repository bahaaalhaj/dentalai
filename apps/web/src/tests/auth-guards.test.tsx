// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { apiClient, ApiClientError } from '../lib/api-client';
// Load the real screen up front: guard assertions must not depend on lazy-import disk latency.
// The production component and its expiry message remain unmocked.
import '../AuthPage';
import { setLocale } from '../i18n';
import { fireEvent } from '@testing-library/react';
import type { AuthIdentity } from '@dentalai/contracts';

beforeEach(() => {
  window.history.replaceState(null, '', '/dashboard');
});
afterEach(() => {
  cleanup();
  localStorage.removeItem('dentalai.locale');
  setLocale('en', false);
  vi.restoreAllMocks();
});
describe('authentication route guards', () => {
  it('follows clinic locale after a membership switch unless the user chose a language', async () => {
    localStorage.removeItem('dentalai.locale');
    const first = {
      id: crypto.randomUUID(),
      clinicId: crypto.randomUUID(),
      clinicName: 'Fictional English',
      roles: ['patient' as const],
      locale: 'en' as const,
    };
    const second = {
      ...first,
      id: crypto.randomUUID(),
      clinicId: crypto.randomUUID(),
      clinicName: 'Fictional Arabic',
      locale: 'ar' as const,
    };
    const identity: AuthIdentity = {
      user: {
        id: crypto.randomUUID(),
        name: 'Fictional',
        email: 'f@example.test',
        emailVerified: true,
      },
      memberships: [first, second],
      activeMembership: first,
      accountRole: 'patient',
    };
    const me = vi
      .spyOn(apiClient, 'me')
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce({ ...identity, activeMembership: second });
    vi.spyOn(apiClient, 'sessions').mockResolvedValue([]);
    vi.spyOn(apiClient, 'notificationPreferences').mockResolvedValue({ operationalEmail: true });
    vi.spyOn(apiClient, 'selectMembership').mockResolvedValue({ success: true });
    render(<App />);
    const selector = await screen.findByLabelText('Active clinic');
    fireEvent.change(selector, { target: { value: second.id } });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(document.documentElement.lang).toBe('ar');
    expect(localStorage.getItem('dentalai.locale')).toBeNull();
    fireEvent.change(screen.getByLabelText('اللغة'), { target: { value: 'ar' } });
    me.mockResolvedValueOnce(identity);
    fireEvent.change(screen.getByLabelText('العيادة النشطة'), { target: { value: first.id } });
    await waitFor(() =>
      expect((screen.getByLabelText('العيادة النشطة') as HTMLSelectElement).value).toBe(first.id),
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(localStorage.getItem('dentalai.locale')).toBe('ar');
  });
  it('redirects an unauthenticated dashboard to sign-in with a clear expiry message', async () => {
    vi.spyOn(apiClient, 'me').mockRejectedValue(new ApiClientError(401, undefined));
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();
    expect(
      screen.getByText('Your session expired or was revoked. Sign in again.'),
    ).toBeInTheDocument();
  });
  it('does not turn a backend outage into a patient session', async () => {
    vi.spyOn(apiClient, 'me').mockRejectedValue(new ApiClientError(503, undefined));
    render(<App />);
    expect(await screen.findByText(/Account service unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/Patient account/)).not.toBeInTheDocument();
  });
  it('restores server roles and removes access when a session expires', async () => {
    vi.spyOn(apiClient, 'me').mockResolvedValue({
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Fictional',
        email: 'f@example.test',
        emailVerified: true,
      },
      accountRole: 'patient',
      activeMembership: null,
      memberships: [],
    });
    vi.spyOn(apiClient, 'sessions').mockResolvedValue([]);
    render(<App />);
    expect(await screen.findByText(/Patient account/)).toBeInTheDocument();
    expect(screen.queryByText('Invite clinic staff')).not.toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new Event('dentalai:session-expired'));
    });
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument(),
    );
  });
});
