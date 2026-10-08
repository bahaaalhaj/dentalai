// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DentalAiApiClient, ApiClientError } from '../lib/api-client';

describe('backend-owned frontend authentication', () => {
  it('uses credentialed requests with a CSRF token and never supplies a registration role', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'signed-csrf' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true })));
    const client = new DentalAiApiClient({ fetch: transport });
    await client.register({
      name: 'Fictional',
      email: 'fictional@example.test',
      password: 'Strong-fixture-password',
    });
    expect(transport.mock.calls[0]?.[0]).toBe('/api/v1/access/csrf');
    const init = transport.mock.calls[1]?.[1];
    expect(init?.credentials).toBe('same-origin');
    expect(init?.headers).toMatchObject({ 'x-csrf-token': 'signed-csrf' });
    expect(String(init?.body)).not.toContain('role');
    expect(String(init?.body)).not.toContain('clinicId');
  });
  it('notifies route guards on expired or revoked sessions', async () => {
    const listener = vi.fn();
    window.addEventListener('dentalai:session-expired', listener);
    const client = new DentalAiApiClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 })),
    });
    await expect(client.me()).rejects.toBeInstanceOf(ApiClientError);
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener('dentalai:session-expired', listener);
  });
  it('rejects malformed identity responses instead of granting fallback roles', async () => {
    const client = new DentalAiApiClient({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ role: 'doctor' }))),
    });
    await expect(client.me()).rejects.toThrow();
  });
});
