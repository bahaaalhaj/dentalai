import { Temporal } from '@js-temporal/polyfill';

export const appointmentStates = [
  'scheduled',
  'confirmed',
  'checked_in',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type AppointmentState = (typeof appointmentStates)[number];
export type AppointmentAction =
  'confirm' | 'cancel' | 'no_show' | 'complete' | 'check_in' | 'start';
export const actionTargets: Record<AppointmentAction, AppointmentState> = {
  confirm: 'confirmed',
  cancel: 'cancelled',
  no_show: 'no_show',
  complete: 'completed',
  check_in: 'checked_in',
  start: 'in_progress',
};
const transitions: Record<AppointmentState, readonly AppointmentState[]> = {
  scheduled: ['confirmed', 'cancelled', 'no_show'],
  confirmed: ['checked_in', 'completed', 'cancelled', 'no_show'],
  checked_in: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};
export function canTransition(from: AppointmentState, to: AppointmentState): boolean {
  return transitions[from].includes(to);
}
export function isTerminal(status: AppointmentState): boolean {
  return ['completed', 'cancelled', 'no_show'].includes(status);
}
export function dateInZone(instant: string, timezone: string): string {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(timezone).toPlainDate().toString();
}
export function clinicToday(timezone: string): string {
  return Temporal.Now.instant().toZonedDateTimeISO(timezone).toPlainDate().toString();
}
export function formatAppointmentTime(instant: string, timezone: string, locale = 'en-GB'): string {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timezone)
    .toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}
export function localDateWindow(
  date: string,
  timezone: string,
): { startsAt: string; endsAt: string } {
  const day = Temporal.PlainDate.from(date);
  return {
    startsAt: day.toZonedDateTime(timezone).toInstant().toString(),
    endsAt: day.add({ days: 1 }).toZonedDateTime(timezone).toInstant().toString(),
  };
}
export function weekday(date: string): number {
  return Temporal.PlainDate.from(date).dayOfWeek % 7;
}
export function localWallTimeToInstant(value: string, timezone: string): string {
  return Temporal.PlainDateTime.from(value)
    .toZonedDateTime(timezone, { disambiguation: 'reject' })
    .toInstant()
    .toString();
}
export function calendarDateDistance(from: string, to: string): number {
  return Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to)).days;
}
export function addCalendarDays(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

// Conservative first-release DST policy: do not offer ambiguous/nonexistent wall times or slots
// crossing an offset change. Duration is always elapsed minutes, not browser wall-clock arithmetic.
export function wallClockSlots(
  date: string,
  timezone: string,
  opens: string,
  closes: string,
  duration: number,
): { startsAt: string; endsAt: string }[] {
  const day = Temporal.PlainDate.from(date);
  const opening = Temporal.PlainTime.from(opens);
  const closing = Temporal.PlainTime.from(closes);
  const result: { startsAt: string; endsAt: string }[] = [];
  const first = opening.hour * 60 + opening.minute;
  const last = closing.hour * 60 + closing.minute;
  for (let minute = first; minute + duration <= last; minute += 15) {
    try {
      const local = day.toPlainDateTime({ hour: Math.floor(minute / 60), minute: minute % 60 });
      const start = local.toZonedDateTime(timezone, { disambiguation: 'reject' });
      const end = start.add({ minutes: duration });
      end.toPlainDateTime().toZonedDateTime(timezone, { disambiguation: 'reject' });
      if (
        start.offset !== end.offset ||
        !end.toPlainDate().equals(day) ||
        Temporal.PlainTime.compare(end.toPlainTime(), closing) > 0
      )
        continue;
      result.push({ startsAt: start.toInstant().toString(), endsAt: end.toInstant().toString() });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return result;
}
