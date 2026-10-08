import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Shield } from 'lucide-react';
import { ActionDialog } from '@dentalai/ui';
import {
  canTransition,
  actionTargets,
  clinicToday,
  formatAppointmentTime,
  localWallTimeToInstant,
} from '@dentalai/domain';
import type {
  AuthIdentity,
  Appointment,
  SchedulingCatalog,
  SlotSchema,
  AppointmentActionSchema,
  AppointmentHistorySchema,
} from '@dentalai/contracts';
import type { z } from 'zod';
import { apiClient } from './lib/api-client';
import { getErrorMessage } from './lib/errors';
const input = 'w-full p-3 rounded-xl border border-slate-200 bg-slate-50';
const button = 'px-4 py-2 rounded-xl bg-indigo-600 text-white disabled:opacity-50';
type Modal =
  | { kind: 'book' | 'reschedule'; appointment?: Appointment }
  | {
      kind: 'action';
      appointment: Appointment;
      action: z.infer<typeof AppointmentActionSchema>['action'];
    }
  | { kind: 'history'; appointment: Appointment };

export function AppointmentsPage({ identity }: { identity: AuthIdentity }) {
  const [catalog, setCatalog] = useState<SchedulingCatalog | null>(null);
  const [items, setItems] = useState<Appointment[]>([]);
  const [view, setView] = useState<'upcoming' | 'history'>('upcoming');
  const [calendarDate, setCalendarDate] = useState('');
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [location, setLocation] = useState('');
  const [type, setType] = useState('');
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<z.infer<typeof SlotSchema>[]>([]);
  const [availabilityMessage, setAvailabilityMessage] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [patientId, setPatientId] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notification, setNotification] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<z.infer<typeof AppointmentHistorySchema>>([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const roles = identity.activeMembership?.roles ?? [];
  const staff = roles.some((role) => role !== 'patient');
  const admin = roles.some((role) => role === 'clinic_owner' || role === 'clinic_admin');
  const clinicalStaff = roles.some(
    (role) => role === 'dentist' || role === 'clinic_owner' || role === 'clinic_admin',
  );
  const refresh = useCallback(async () => {
    const result = await apiClient.appointments({
      view,
      offset,
      ...(calendarDate ? { date: calendarDate } : {}),
    });
    setItems(result.items);
    setNextOffset(result.nextOffset);
  }, [view, offset, calendarDate]);
  useEffect(() => {
    let active = true;
    apiClient
      .schedulingCatalog()
      .then((value) => {
        if (!active) return;
        setCatalog(value);
        setLocation(value.locations[0]?.id ?? '');
        setType(value.types[0]?.id ?? '');
        setDate(clinicToday(value.locations[0]?.timezone ?? value.clinicTimezone));
      })
      .catch((err: unknown) => {
        if (active) setError(getErrorMessage(err));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    apiClient
      .appointments({ view, offset, ...(calendarDate ? { date: calendarDate } : {}) })
      .then((result) => {
        if (active) {
          setItems(result.items);
          setNextOffset(result.nextOffset);
        }
      })
      .catch((err: unknown) => {
        if (active) setError(getErrorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [view, offset, calendarDate]);
  const run = async (operation: () => Promise<unknown>, success: string, close = false) => {
    setBusy(true);
    setError('');
    try {
      await operation();
      setNotification(success);
      if (close) setModal(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const timezone =
    catalog?.locations.find((item) => item.id === location)?.timezone ??
    catalog?.clinicTimezone ??
    'Etc/UTC';
  function clearOffers() {
    setSlots([]);
    setAvailabilityMessage('');
    setSelectedSlot('');
  }
  async function search() {
    clearOffers();
    const result = await apiClient.availability({
      locationId: location,
      appointmentTypeId: type,
      date,
    });
    setSlots(result.slots);
    setAvailabilityMessage(
      result.slots.length
        ? `${result.slots.length} available times. Offers expire after five minutes and are not reserved until booked.`
        : 'No available slots for this date. Choose another date or ask the clinic about its working hours.',
    );
  }
  function openBooking(appointment?: Appointment) {
    clearOffers();
    setReason('');
    setError('');
    if (appointment) setType(appointment.appointmentTypeId);
    setModal(appointment ? { kind: 'reschedule', appointment } : { kind: 'book' });
  }
  async function submitBooking() {
    if (modal?.kind === 'reschedule' && modal.appointment)
      await apiClient.rescheduleAppointment(
        modal.appointment.id,
        selectedSlot,
        modal.appointment.revision,
      );
    else if (staff) await apiClient.bookStaffAppointment(selectedSlot, patientId);
    else await apiClient.bookAppointment(selectedSlot);
    await refresh();
  }
  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex justify-between">
          <Link to="/dashboard" className="flex gap-2 text-indigo-600 font-bold">
            <Shield />
            DentalAi · Account
          </Link>
          <h1 className="text-2xl font-bold flex gap-2">
            <Calendar />
            {staff ? 'Clinic calendar' : 'My appointments'}
          </h1>
        </header>
        <p className="text-slate-600">
          {identity.activeMembership?.clinicName} · Times are displayed in each appointment's clinic
          location timezone, not your device timezone.
        </p>
        {notification && (
          <p role="status" aria-live="polite" className="p-4 bg-indigo-50 rounded-xl">
            {notification}
          </p>
        )}
        {error && !modal && (
          <p role="alert" className="p-4 bg-red-50 text-red-700 rounded-xl">
            {error}
          </p>
        )}
        <section className="bg-white border border-slate-200 rounded-3xl p-6 space-y-5">
          <div className="flex flex-wrap gap-3">
            <button
              className={button}
              disabled={busy || !catalog?.types.length || !catalog?.locations.length}
              onClick={() => openBooking()}
            >
              Book appointment
            </button>
            <button
              aria-pressed={view === 'upcoming'}
              onClick={() => {
                setView('upcoming');
                setOffset(0);
              }}
            >
              Upcoming
            </button>
            <button
              aria-pressed={view === 'history'}
              onClick={() => {
                setView('history');
                setOffset(0);
              }}
            >
              History
            </button>
            <button disabled={busy} onClick={() => void run(refresh, 'Appointments refreshed.')}>
              Refresh
            </button>
          </div>
          {staff && (
            <label className="block">
              Calendar date (location local day)
              <input
                aria-label="Calendar date"
                className={input}
                type="date"
                value={calendarDate}
                onChange={(event) => {
                  setCalendarDate(event.target.value);
                  setOffset(0);
                }}
              />
              <button
                onClick={() => {
                  setCalendarDate('');
                  setOffset(0);
                }}
              >
                Show all dates
              </button>
            </label>
          )}
          {!items.length && <p>No appointments in this view.</p>}
          <div className="space-y-4">
            {items.map((appointment) => (
              <article
                key={appointment.id}
                className="border border-slate-200 rounded-2xl p-5 space-y-3"
                aria-label={`${appointment.typeName} appointment`}
              >
                <div className="flex justify-between">
                  <h2 className="font-bold">
                    {appointment.typeName}
                    {staff && ` · ${appointment.patientName ?? 'Patient'}`}
                  </h2>
                  <span className="text-indigo-700">{appointment.status}</span>
                </div>
                <p>
                  {formatAppointmentTime(appointment.startsAt, appointment.timezone)} –{' '}
                  {formatAppointmentTime(appointment.endsAt, appointment.timezone)} (
                  {appointment.timezone})
                </p>
                <p>
                  {appointment.locationName} · {appointment.providerName ?? 'Provider'} ·{' '}
                  {appointment.operatoryName ?? 'Chair'}
                </p>
                <div className="flex flex-wrap gap-3">
                  {['scheduled', 'confirmed'].includes(appointment.status) &&
                    Date.parse(appointment.startsAt) > now && (
                      <button disabled={busy} onClick={() => openBooking(appointment)}>
                        Reschedule
                      </button>
                    )}
                  {(['confirm', 'cancel', 'no_show', 'check_in', 'start', 'complete'] as const)
                    .filter(
                      (action) =>
                        canTransition(appointment.status, actionTargets[action]) &&
                        (staff || action === 'cancel') &&
                        (!['start', 'complete'].includes(action) || clinicalStaff),
                    )
                    .map((action) => (
                      <button
                        key={action}
                        disabled={busy}
                        className="text-indigo-700"
                        onClick={() => {
                          setReason('');
                          setError('');
                          setModal({ kind: 'action', appointment, action });
                        }}
                      >
                        {
                          {
                            confirm: 'Confirm',
                            cancel: 'Cancel',
                            no_show: 'Mark no-show',
                            check_in: 'Check in',
                            start: 'Start',
                            complete: 'Complete',
                          }[action]
                        }
                      </button>
                    ))}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setHistory(await apiClient.appointmentHistory(appointment.id));
                        setModal({ kind: 'history', appointment });
                      }, 'History loaded.')
                    }
                  >
                    Audit trail
                  </button>
                </div>
              </article>
            ))}
          </div>
          <div className="flex gap-3">
            <button
              disabled={offset === 0 || busy}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Previous page
            </button>
            <button
              disabled={nextOffset === null || busy}
              onClick={() => {
                if (nextOffset !== null) setOffset(nextOffset);
              }}
            >
              Next page
            </button>
          </div>
        </section>
        {admin && catalog && (
          <SchedulingSettings
            catalog={catalog}
            reload={async () => setCatalog(await apiClient.schedulingCatalog())}
            run={run}
            busy={busy}
          />
        )}
        {modal && (
          <ActionDialog
            title={
              modal.kind === 'history'
                ? 'Appointment audit trail'
                : modal.kind === 'action'
                  ? `${{ confirm: 'Confirm appointment', cancel: 'Cancel appointment', no_show: 'Mark no-show', check_in: 'Check in', start: 'Start appointment', complete: 'Complete appointment' }[modal.action]}`
                  : modal.kind === 'reschedule'
                    ? 'Reschedule appointment'
                    : 'Book appointment'
            }
            onClose={() => {
              setModal(null);
              setError('');
            }}
            busy={busy}
          >
            {error && (
              <p role="alert" className="text-red-700 mb-3">
                {error}
              </p>
            )}
            {(modal.kind === 'book' || modal.kind === 'reschedule') && (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    submitBooking,
                    modal.kind === 'reschedule'
                      ? 'Appointment rescheduled; staff confirmation is required again.'
                      : 'Appointment booked; pending clinic confirmation.',
                    true,
                  );
                }}
              >
                <label className="block">
                  Location
                  <select
                    aria-label="Location"
                    className={input}
                    value={location}
                    onChange={(event) => {
                      setLocation(event.target.value);
                      clearOffers();
                    }}
                  >
                    {catalog?.locations.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  Appointment type
                  <select
                    aria-label="Appointment type"
                    className={input}
                    value={type}
                    disabled={modal.kind === 'reschedule'}
                    onChange={(event) => {
                      setType(event.target.value);
                      clearOffers();
                    }}
                  >
                    {catalog?.types.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.durationMinutes} minutes)
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  Date ({timezone})
                  <input
                    aria-label="Booking date"
                    className={input}
                    type="date"
                    min={clinicToday(timezone)}
                    required
                    value={date}
                    onChange={(event) => {
                      setDate(event.target.value);
                      clearOffers();
                    }}
                  />
                </label>
                {staff && modal.kind === 'book' && (
                  <label className="block">
                    Patient record UUID
                    <input
                      aria-label="Patient record UUID"
                      className={input}
                      required
                      value={patientId}
                      onChange={(event) => setPatientId(event.target.value)}
                    />
                    <span className="text-sm text-slate-500">
                      Use a patient record belonging to this clinic; portal user IDs are not patient
                      IDs.
                    </span>
                  </label>
                )}
                <button
                  type="button"
                  className={button}
                  disabled={busy || !location || !type || !date}
                  onClick={() => void run(search, 'Availability refreshed.')}
                >
                  Search availability
                </button>
                <fieldset>
                  <legend>Available times ({timezone})</legend>
                  {availabilityMessage && (
                    <p role="status" aria-live="polite">
                      {availabilityMessage}
                    </p>
                  )}
                  <div className="grid gap-2">
                    {slots.map((slot) => (
                      <label key={slot.token} className="flex gap-2">
                        <input
                          type="radio"
                          name="slot"
                          value={slot.token}
                          checked={selectedSlot === slot.token}
                          onChange={() => setSelectedSlot(slot.token)}
                        />
                        {formatAppointmentTime(slot.startsAt, slot.timezone)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <button className={button} disabled={busy || !selectedSlot}>
                  {modal.kind === 'reschedule' ? 'Save reschedule' : 'Book selected time'}
                </button>
              </form>
            )}
            {modal.kind === 'action' && (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    async () => {
                      await apiClient.appointmentAction(modal.appointment.id, {
                        action: modal.action,
                        revision: modal.appointment.revision,
                        ...(reason ? { reason } : {}),
                      });
                      await refresh();
                    },
                    `Appointment ${actionTargets[modal.action].replace('_', ' ')}.`,
                    true,
                  );
                }}
              >
                <p>
                  {formatAppointmentTime(modal.appointment.startsAt, modal.appointment.timezone)} (
                  {modal.appointment.timezone}). This change is recorded in the audit trail.
                </p>
                {['cancel', 'no_show'].includes(modal.action) && (
                  <label className="block">
                    Reason
                    <textarea
                      aria-label="Reason"
                      className={input}
                      maxLength={500}
                      required
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </label>
                )}
                <button className={button} disabled={busy}>
                  Apply change
                </button>
              </form>
            )}
            {modal.kind === 'history' && (
              <ol className="space-y-3">
                {history.map((event, index) => (
                  <li key={index}>
                    <p className="font-bold">{event.action}</p>
                    <p>{formatAppointmentTime(event.occurredAt, modal.appointment.timezone)}</p>
                    <p>
                      {String(event.before?.['status'] ?? 'new')} →{' '}
                      {String(event.after['status'] ?? '')}
                    </p>
                    {typeof event.after['startsAt'] === 'string' && (
                      <p>
                        {formatAppointmentTime(event.after['startsAt'], modal.appointment.timezone)}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </ActionDialog>
        )}
      </div>
    </main>
  );
}

function SchedulingSettings({
  catalog,
  reload,
  run,
  busy,
}: {
  catalog: SchedulingCatalog;
  reload: () => Promise<void>;
  run: (operation: () => Promise<unknown>, message: string) => Promise<void>;
  busy: boolean;
}) {
  const [locationId, setLocationId] = useState(catalog.locations[0]?.id ?? '');
  const [providerId, setProviderId] = useState('');
  const [day, setDay] = useState(1);
  const [opens, setOpens] = useState('09:00');
  const [closes, setCloses] = useState('17:00');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [duration, setDuration] = useState(30);
  const [chair, setChair] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [clinicWide, setClinicWide] = useState(false);
  const [lead, setLead] = useState(catalog.policy.leadMinutes);
  const [horizon, setHorizon] = useState(catalog.policy.horizonDays);
  const save = (operation: () => Promise<unknown>, message: string) =>
    void run(async () => {
      await operation();
      await reload();
    }, message);
  const timezone = clinicWide
    ? catalog.clinicTimezone
    : (catalog.locations.find((item) => item.id === locationId)?.timezone ??
      catalog.clinicTimezone);
  return (
    <details className="bg-white rounded-3xl border border-slate-200 p-6">
      <summary className="font-bold cursor-pointer">Clinic scheduling settings</summary>
      <div className="space-y-6 mt-5">
        <p>
          Providers are created through dentist invitations. Working hours use the selected
          location's timezone; provider hours narrow the general clinic hours.
        </p>
        <p>
          Active providers:{' '}
          {catalog.providers.map((item) => item.name).join(', ') ||
            'None – invite a dentist first.'}
        </p>
        <label className="block">
          Settings location
          <select
            aria-label="Settings location"
            className={input}
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
          >
            {catalog.locations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.timezone})
              </option>
            ))}
          </select>
        </label>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(() => apiClient.addOperatory({ locationId, name: chair }), 'Chair added.');
          }}
        >
          <h2 className="font-bold">Chairs</h2>
          <p>{catalog.operatories.map((item) => item.name).join(', ')}</p>
          <label>
            Chair name
            <input
              aria-label="Chair name"
              className={input}
              required
              value={chair}
              onChange={(event) => setChair(event.target.value)}
            />
          </label>
          <button disabled={busy || !locationId} className={button}>
            Add chair
          </button>
        </form>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(
              () => apiClient.addAppointmentType({ name, code, durationMinutes: duration }),
              'Appointment type added.',
            );
          }}
        >
          <h2 className="font-bold">Appointment types</h2>
          <label>
            Type name
            <input
              aria-label="Type name"
              className={input}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Type code
            <input
              aria-label="Type code"
              className={input}
              required
              pattern="[a-z0-9_-]+"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <label>
            Duration in minutes
            <input
              aria-label="Duration in minutes"
              className={input}
              type="number"
              min={5}
              max={480}
              required
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
            />
          </label>
          <button disabled={busy} className={button}>
            Add type
          </button>
        </form>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(
              () =>
                apiClient.addWorkingHours({
                  locationId,
                  providerId: providerId || null,
                  weekday: day,
                  opensAt: opens,
                  closesAt: closes,
                }),
              'Working hours added.',
            );
          }}
        >
          <h2 className="font-bold">Working hours</h2>
          <label>
            Hours apply to
            <select
              aria-label="Hours provider"
              className={input}
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
            >
              <option value="">General clinic hours</option>
              {catalog.providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Weekday
            <select
              aria-label="Hours weekday"
              className={input}
              value={day}
              onChange={(event) => setDay(Number(event.target.value))}
            >
              {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                (label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Opens
            <input
              aria-label="Opens"
              className={input}
              type="time"
              required
              value={opens}
              onChange={(event) => setOpens(event.target.value)}
            />
          </label>
          <label>
            Closes
            <input
              aria-label="Closes"
              className={input}
              type="time"
              required
              value={closes}
              onChange={(event) => setCloses(event.target.value)}
            />
          </label>
          <button disabled={busy || !locationId} className={button}>
            Add hours
          </button>
        </form>
        {catalog.hours.map((hour) => (
          <div key={hour.id}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][hour.weekday]} {hour.opensAt}–
            {hour.closesAt} · {hour.providerId ? 'Provider' : 'General clinic'}
            <button
              disabled={busy}
              onClick={() =>
                save(
                  () => apiClient.removeWorkingHours(hour.id),
                  'Hours removed; existing appointments are retained.',
                )
              }
            >
              Remove hours
            </button>
          </div>
        ))}
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(
              () =>
                apiClient.addClosure({
                  locationId: clinicWide ? null : locationId,
                  startsAt: localWallTimeToInstant(start, timezone),
                  endsAt: localWallTimeToInstant(end, timezone),
                  reason,
                }),
              'Closure added.',
            );
          }}
        >
          <h2 className="font-bold">Closures ({timezone})</h2>
          <label>
            <input
              type="checkbox"
              checked={clinicWide}
              onChange={(event) => setClinicWide(event.target.checked)}
            />
            Whole clinic
          </label>
          <label>
            Closure starts
            <input
              aria-label="Closure starts"
              className={input}
              type="datetime-local"
              required
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label>
            Closure ends
            <input
              aria-label="Closure ends"
              className={input}
              type="datetime-local"
              required
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
          <label>
            Closure reason
            <input
              aria-label="Closure reason"
              className={input}
              maxLength={500}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button disabled={busy} className={button}>
            Add closure
          </button>
        </form>
        {catalog.closures.map((closure) => (
          <div key={closure.id}>
            {formatAppointmentTime(closure.startsAt, catalog.clinicTimezone)} · {closure.reason}
            <button
              disabled={busy}
              onClick={() => save(() => apiClient.removeClosure(closure.id), 'Closure archived.')}
            >
              Archive closure
            </button>
          </div>
        ))}
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(
              () => apiClient.setSchedulingPolicy({ leadMinutes: lead, horizonDays: horizon }),
              'Booking policy updated.',
            );
          }}
        >
          <h2 className="font-bold">Booking window</h2>
          <label>
            Lead time in minutes
            <input
              aria-label="Lead time"
              className={input}
              type="number"
              min={0}
              max={10080}
              value={lead}
              onChange={(event) => setLead(Number(event.target.value))}
            />
          </label>
          <label>
            Horizon in days
            <input
              aria-label="Booking horizon"
              className={input}
              type="number"
              min={1}
              max={3650}
              value={horizon}
              onChange={(event) => setHorizon(Number(event.target.value))}
            />
          </label>
          <button disabled={busy} className={button}>
            Save policy
          </button>
        </form>
      </div>
    </details>
  );
}
