// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { apiClient, ApiClientError } from '../lib/api-client';
// Load the real screen up front: guard assertions must not depend on lazy-import disk latency.
// The production component and its expiry message remain unmocked.
import '../AuthPage';

beforeEach(() => {
  window.history.replaceState(null, '', '/dashboard');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('authentication route guards', () => {
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
