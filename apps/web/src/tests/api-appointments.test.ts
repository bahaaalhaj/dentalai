// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DentalAiApiClient, ApiClientError } from '../lib/api-client';
const id = '123e4567-e89b-42d3-a456-426614174000';
const appointment = {
  id,
  appointmentTypeId: id,
  startsAt: '2030-01-07T06:00:00Z',
  endsAt: '2030-01-07T06:30:00Z',
  timezone: 'Asia/Baghdad',
  status: 'scheduled',
  revision: 0,
  locationName: 'Fictional clinic',
  providerName: 'Fictional dentist',
  operatoryName: 'Chair one',
  typeName: 'Consultation',
};
function transport(result: unknown, status = 200) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'signed-csrf' })))
    .mockResolvedValueOnce(new Response(JSON.stringify(result), { status }));
}
describe('appointment API client', () => {
  it('patient booking sends only the opaque slot token, with CSRF and session cookies', async () => {
    const fetch = transport(appointment);
    await new DentalAiApiClient({ fetch }).bookAppointment('a'.repeat(64));
    expect(fetch.mock.calls[1]?.[0]).toBe('/api/v1/appointments');
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf-token': 'signed-csrf' },
    });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      slotToken: 'a'.repeat(64),
    });
  });
  it('cancellation is an audited transition with revision, never a DELETE', async () => {
    const fetch = transport({ ...appointment, status: 'cancelled', revision: 1 });
    await new DentalAiApiClient({ fetch }).appointmentAction(id, {
      action: 'cancel',
      revision: 0,
      reason: 'Fictional cancellation',
    });
    expect(fetch.mock.calls[1]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      action: 'cancel',
      revision: 0,
      reason: 'Fictional cancellation',
    });
  });
  it('rescheduling does not send patient, provider, clinic or authoritative status fields', async () => {
    const fetch = transport(appointment);
    await new DentalAiApiClient({ fetch }).rescheduleAppointment(id, 'b'.repeat(64), 3);
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      slotToken: 'b'.repeat(64),
      revision: 3,
    });
  });
  it('surfaces a collision rather than synthesizing a successful booking', async () => {
    const fetch = transport(
      {
        error: { code: 'SLOT_UNAVAILABLE', message: 'Search again.', requestId: 'fixture-request' },
      },
      409,
    );
    await expect(
      new DentalAiApiClient({ fetch }).bookAppointment('c'.repeat(64)),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
  it('does not accept malformed appointment responses', async () => {
    const fetch = transport({ success: true });
    await expect(
      new DentalAiApiClient({ fetch }).bookAppointment('d'.repeat(64)),
    ).rejects.toThrow();
  });
  it('availability cannot return complete rows or patient data through the typed client', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          slots: [
            {
              token: 'e'.repeat(64),
              startsAt: appointment.startsAt,
              endsAt: appointment.endsAt,
              timezone: appointment.timezone,
              patientId: 'secret',
              patientName: 'secret',
              notes: 'secret',
            },
          ],
          expiresAt: appointment.startsAt,
          timezone: appointment.timezone,
          appointments: [{ id: 'secret' }],
        }),
      ),
    );
    const result = await new DentalAiApiClient({ fetch }).availability({
      locationId: id,
      appointmentTypeId: id,
      date: '2030-01-07',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('expired appointment sessions notify the route guard', async () => {
    const listener = vi.fn();
    window.addEventListener('dentalai:session-expired', listener);
    try {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response('{}', { status: 401 }));
      await expect(new DentalAiApiClient({ fetch }).appointments()).rejects.toBeInstanceOf(
        ApiClientError,
      );
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('dentalai:session-expired', listener);
    }
  });
});
