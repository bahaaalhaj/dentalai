import { describe, expect, it, vi } from 'vitest';
import { DentalAiApiClient } from '../lib/api-client';
describe('production clinical API client', () => {
  it('rejects invalid clinical data before network access', async () => {
    const fetch = vi.fn();
    const client = new DentalAiApiClient({ fetch });
    expect(() =>
      client.writeClinicalRecord(crypto.randomUUID(), {
        encounterId: crypto.randomUUID(),
        supersedesId: null,
        reason: 'Fictional entry',
        data: {
          kind: 'finding',
          toothCode: '99',
          surfaces: [],
          findingCode: 'caries',
          status: 'active',
          details: null,
        },
      }),
    ).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses a patient-specific approved portal without a browser-supplied patient identifier', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ records: [], history: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = new DentalAiApiClient({ fetch });
    expect(await client.clinicalPortal()).toEqual({ records: [], history: [] });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/clinical/portal',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
  });
});
