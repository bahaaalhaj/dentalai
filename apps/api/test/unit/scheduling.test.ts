import { describe, expect, it } from 'vitest';
import {
  canTransition,
  wallClockSlots,
  localDateWindow,
  dateInZone,
  weekday,
  formatAppointmentTime,
} from '@dentalai/domain';
import { BookingSchema, AppointmentActionSchema, AvailabilitySchema } from '@dentalai/contracts';
describe('appointment rules and timezone semantics', () => {
  it('localizes presentation without altering the appointment instant/timezone', () => {
    const instant = '2026-01-05T09:00:00Z';
    expect(formatAppointmentTime(instant, 'Asia/Baghdad')).toContain('12:00');
    expect(formatAppointmentTime(instant, 'Asia/Baghdad', 'ar')).not.toBe(
      formatAppointmentTime(instant, 'Asia/Baghdad'),
    );
  });
  it('accepts explicit transitions and keeps terminal states terminal', () => {
    expect(canTransition('scheduled', 'confirmed')).toBe(true);
    expect(canTransition('scheduled', 'completed')).toBe(false);
    for (const state of ['completed', 'cancelled', 'no_show'] as const)
      for (const next of ['scheduled', 'confirmed', 'completed'] as const)
        expect(canTransition(state, next)).toBe(false);
  });
  it('rejects every browser-owned authority override in patient booking', () => {
    for (const extra of [
      { clinicId: 'fake' },
      { patientId: 'fake' },
      { providerId: 'fake' },
      { status: 'confirmed' },
      { confirmation_state: 'confirmed' },
      { endsAt: 'fake' },
    ])
      expect(BookingSchema.safeParse({ slotToken: 'a'.repeat(64), ...extra }).success).toBe(false);
    expect(AppointmentActionSchema.safeParse({ action: 'confirmed', revision: 0 }).success).toBe(
      false,
    );
  });
  it('uses the clinic local day rather than the host timezone', () => {
    expect(dateInZone('2026-10-07T22:00:00Z', 'Asia/Baghdad')).toBe('2026-10-08');
    expect(weekday('2026-10-09')).toBe(5);
    expect(wallClockSlots('2030-01-07', 'Asia/Baghdad', '09:00', '10:00', 30)[0]).toEqual({
      startsAt: '2030-01-07T06:00:00Z',
      endsAt: '2030-01-07T06:30:00Z',
    });
  });
  it('handles short and long local days explicitly', () => {
    const spring = localDateWindow('2027-03-14', 'America/New_York');
    const autumn = localDateWindow('2027-11-07', 'America/New_York');
    expect((Date.parse(spring.endsAt) - Date.parse(spring.startsAt)) / 3600000).toBe(23);
    expect((Date.parse(autumn.endsAt) - Date.parse(autumn.startsAt)) / 3600000).toBe(25);
  });
  it('does not offer nonexistent, ambiguous, or offset-crossing DST slots', () => {
    const spring = wallClockSlots('2027-03-14', 'America/New_York', '01:00', '04:00', 30);
    expect(spring.map((slot) => slot.startsAt)).not.toContain('2027-03-14T06:45:00Z');
    expect(spring.some((slot) => slot.startsAt === '2027-03-14T07:00:00Z')).toBe(true);
    const autumn = wallClockSlots('2027-11-07', 'America/New_York', '00:00', '03:00', 30);
    expect(
      autumn.some(
        (slot) =>
          slot.startsAt.startsWith('2027-11-07T05:') || slot.startsAt.startsWith('2027-11-07T06:'),
      ),
    ).toBe(false);
    for (const slot of [...spring, ...autumn])
      expect(Date.parse(slot.endsAt) - Date.parse(slot.startsAt)).toBe(30 * 60000);
  });
  it('has an availability DTO with no patient or appointment rows', () => {
    const parsed = AvailabilitySchema.parse({
      slots: [
        {
          token: 'b'.repeat(64),
          startsAt: '2030-01-01T09:00:00Z',
          endsAt: '2030-01-01T09:30:00Z',
          timezone: 'Etc/UTC',
          patientId: 'secret',
          patientName: 'secret',
          notes: 'secret',
        },
      ],
      expiresAt: '2030-01-01T08:00:00Z',
      timezone: 'Etc/UTC',
      appointments: [{ id: 'secret' }],
    });
    expect(JSON.stringify(parsed)).not.toContain('secret');
    expect(Object.keys(parsed.slots[0]!)).toEqual(['token', 'startsAt', 'endsAt', 'timezone']);
  });
});
