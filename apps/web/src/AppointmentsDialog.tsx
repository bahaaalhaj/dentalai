import { t } from './i18n';
import { displayStatus } from './i18n/display';
import { formatAppointmentTime } from './appointment-format';
import { ActionDialog } from '@dentalai/ui';
import { actionTargets, clinicToday } from '@dentalai/domain';
import { apiClient } from './lib/api-client';
import { input, button } from './appointment-shared';
import type { useAppointments } from './useAppointments';
export function AppointmentsDialog({ state }: { state: ReturnType<typeof useAppointments> }) {
  const {
    catalog,
    location,
    setLocation,
    type,
    setType,
    date,
    setDate,
    slots,
    availabilityMessage,
    selectedSlot,
    setSelectedSlot,
    patientId,
    setPatientId,
    modal,
    setModal,
    reason,
    setReason,
    busy,
    error,
    setError,
    history,
    staff,
    refresh,
    run,
    timezone,
    clearOffers,
    search,
    submitBooking,
  } = state;
  return (
    <>
      {modal && (
        <ActionDialog
          title={
            modal.kind === 'history'
              ? t('ui.259cb0842b7be881')
              : modal.kind === 'action'
                ? t('ui.5b5219411d291239', {
                    v0: {
                      confirm: t('ui.c601066a2f45d977'),
                      cancel: t('ui.efd06e321fd82fa9'),
                      no_show: t('ui.1632dd2ac4100248'),
                      check_in: t('ui.20e82b4d236aec04'),
                      start: t('ui.062db71c428be311'),
                      complete: t('ui.ff147415402fe750'),
                    }[modal.action],
                  })
                : modal.kind === 'reschedule'
                  ? t('ui.25ece142842014ff')
                  : t('ui.eefda2bfa8623a6a')
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
                    ? t('appointment.rescheduled')
                    : t('appointment.booked'),
                  true,
                );
              }}
            >
              <label className="block">
                {t('ui.15b61974b2707a7b')}
                <select
                  aria-label={t('ui.15b61974b2707a7b')}
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
                {t('ui.3d3ef221d75e705d')}
                <select
                  aria-label={t('ui.3d3ef221d75e705d')}
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
                      {item.name} ({item.durationMinutes} {t('ui.87a54b98d2ee7615')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                {t('ui.53c140763ccb5e7b')}
                {timezone})
                <input
                  aria-label={t('ui.ee620d8ed25e4c5e')}
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
                  {t('ui.ef30502d2c7bdbc0')}
                  <input
                    aria-label={t('ui.ef30502d2c7bdbc0')}
                    className={input}
                    required
                    value={patientId}
                    onChange={(event) => setPatientId(event.target.value)}
                  />
                  <span className="text-sm text-slate-500">{t('ui.93dd6a396ae00fe5')}</span>
                </label>
              )}
              <button
                type="button"
                className={button}
                disabled={busy || !location || !type || !date}
                onClick={() => void run(search, t('ui.d5d19b0b87df1654'))}
              >
                {t('ui.0f6d17ebda8ba3ff')}
              </button>
              <fieldset>
                <legend>
                  {t('ui.42a4849e0024f2d3')}
                  {timezone})
                </legend>
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
                {modal.kind === 'reschedule' ? t('ui.7705a94cae1f2a2f') : t('ui.7cb7151ca434bd77')}
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
                  t('appointment.changed', { status: displayStatus(actionTargets[modal.action]) }),
                  true,
                );
              }}
            >
              <p>
                {formatAppointmentTime(modal.appointment.startsAt, modal.appointment.timezone)} (
                {modal.appointment.timezone}
                {t('ui.be59bc0d97c949c4')}
              </p>
              {['cancel', 'no_show'].includes(modal.action) && (
                <label className="block">
                  {t('ui.f81ab834de5f8491')}
                  <textarea
                    aria-label={t('ui.f81ab834de5f8491')}
                    className={input}
                    maxLength={500}
                    required
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
              )}
              <button className={button} disabled={busy}>
                {t('ui.594c44e38834445f')}
              </button>
            </form>
          )}
          {modal.kind === 'history' && (
            <ol className="space-y-3">
              {history.map((event, index) => (
                <li key={index}>
                  <p className="font-bold">{displayStatus(event.action)}</p>
                  <p>{formatAppointmentTime(event.occurredAt, modal.appointment.timezone)}</p>
                  <p>
                    {displayStatus(String(event.before?.['status'] ?? 'new'))} →{' '}
                    {displayStatus(String(event.after['status'] ?? ''))}
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
    </>
  );
}
