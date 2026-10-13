import { t } from './i18n';
import { displayStatus } from './i18n/display';
import { formatAppointmentTime } from './appointment-format';
import { Link } from 'react-router-dom';
import { Calendar, Shield } from 'lucide-react';
import { canTransition, actionTargets } from '@dentalai/domain';
import type { AuthIdentity } from '@dentalai/contracts';
import { apiClient } from './lib/api-client';
import { input, button } from './appointment-shared';
import { useAppointments } from './useAppointments';
import { SchedulingSettings } from './SchedulingSettings';
import { AppointmentsDialog } from './AppointmentsDialog';
export function AppointmentsPage({ identity }: { identity: AuthIdentity }) {
  const state = useAppointments(identity);
  const {
    catalog,
    setCatalog,
    items,
    view,
    setView,
    calendarDate,
    setCalendarDate,
    offset,
    setOffset,
    nextOffset,
    modal,
    setModal,
    setReason,
    busy,
    notification,
    error,
    setError,
    setHistory,
    now,
    staff,
    admin,
    clinicalStaff,
    refresh,
    run,
    openBooking,
  } = state;
  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex justify-between">
          <Link to="/dashboard" className="flex gap-2 text-indigo-600 font-bold">
            <Shield />
            {t('ui.406dbd46e95a082b')}
          </Link>
          <h1 className="text-2xl font-bold flex gap-2">
            <Calendar />
            {staff ? t('ui.2ebe857f6dedd371') : t('ui.b98e4d4f12df4242')}
          </h1>
        </header>
        <p className="text-slate-600">
          {identity.activeMembership?.clinicName} {t('ui.3961abf5d7ac7e63')}
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
              {t('ui.eefda2bfa8623a6a')}
            </button>
            <button
              aria-pressed={view === 'upcoming'}
              onClick={() => {
                setView('upcoming');
                setOffset(0);
              }}
            >
              {t('ui.5f1a2542e4e4ca5e')}
            </button>
            <button
              aria-pressed={view === 'history'}
              onClick={() => {
                setView('history');
                setOffset(0);
              }}
            >
              {t('ui.0e76960093379060')}
            </button>
            <button disabled={busy} onClick={() => void run(refresh, t('ui.5964f10db0d73999'))}>
              {t('ui.0e91610117029a62')}
            </button>
          </div>
          {staff && (
            <label className="block">
              {t('ui.14bf654846ab9b44')}
              <input
                aria-label={t('ui.16c7fa8e242186e2')}
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
                {t('ui.89f488b4e4dc3211')}
              </button>
            </label>
          )}
          {!items.length && <p>{t('ui.ef3db8e8e994c3b6')}</p>}
          <div className="space-y-4">
            {items.map((appointment) => (
              <article
                key={appointment.id}
                className="border border-slate-200 rounded-2xl p-5 space-y-3"
                aria-label={t('ui.9724a6bd199b45e0', { v0: appointment.typeName })}
              >
                <div className="flex justify-between">
                  <h2 className="font-bold">
                    {appointment.typeName}
                    {staff &&
                      t('ui.8b43bbfd20d38ad2', {
                        v0: appointment.patientName ?? t('role.patient'),
                      })}
                  </h2>
                  <span className="text-indigo-700">{displayStatus(appointment.status)}</span>
                </div>
                <p>
                  {formatAppointmentTime(appointment.startsAt, appointment.timezone)} –{' '}
                  {formatAppointmentTime(appointment.endsAt, appointment.timezone)} (
                  {appointment.timezone})
                </p>
                <p>
                  {appointment.locationName} · {appointment.providerName ?? t('fallback.provider')}{' '}
                  · {appointment.operatoryName ?? t('fallback.chair')}
                </p>
                <div className="flex flex-wrap gap-3">
                  {['scheduled', 'confirmed'].includes(appointment.status) &&
                    Date.parse(appointment.startsAt) > now && (
                      <button disabled={busy} onClick={() => openBooking(appointment)}>
                        {t('ui.a6a80431b02464c1')}
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
                            confirm: t('ui.eebdd24a77d9ad32'),
                            cancel: t('ui.19766ed6ccb2f4a3'),
                            no_show: t('ui.1632dd2ac4100248'),
                            check_in: t('ui.20e82b4d236aec04'),
                            start: t('ui.e4bb9f1ece9af926'),
                            complete: t('ui.143b270a32602d41'),
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
                      }, t('ui.b156d13fd7f5a690'))
                    }
                  >
                    {t('ui.c1ada08ce13857e4')}
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
              {t('ui.1208ec01f223c616')}
            </button>
            <button
              disabled={nextOffset === null || busy}
              onClick={() => {
                if (nextOffset !== null) setOffset(nextOffset);
              }}
            >
              {t('ui.c08ac736a5e29c29')}
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
        <AppointmentsDialog state={state} />
      </div>
    </main>
  );
}
