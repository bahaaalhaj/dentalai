import { lazy, Suspense, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Users, CalendarDays, Clock3, CheckCircle2, ArrowUpRight } from 'lucide-react';
import type { AuthIdentity } from '@dentalai/contracts';
import { AccountDashboard } from '../AccountPage';
import { useDashboard } from './useDashboard';
import { t } from '../i18n';
import { formatInstant } from '../i18n/display';
import { formatAppointmentTime } from '../appointment-format';
import { showMoney } from '../billing/Money';
import { PageState } from '../ui/PageState';
import { StatusBadge } from '../ui/StatusBadge';
const AppointmentDistribution = lazy(() =>
  import('./AppointmentDistribution').then((m) => ({ default: m.AppointmentDistribution })),
);

export function DashboardPage({
  identity,
  refresh,
}: {
  identity: AuthIdentity;
  refresh: () => Promise<void>;
}) {
  const { data, loading, error, refresh: refreshOverview } = useDashboard(identity);
  const location = useLocation(),
    member = identity.activeMembership;
  const [accountOpen, setAccountOpen] = useState(false);
  const staff = member?.roles.some((role) => role !== 'patient') ?? false;
  const dentist = member?.roles.includes('dentist') ?? false;
  if (!member)
    return (
      <main>
        <header className="ui-page-header">
          <div>
            <h1>{t('polish.welcome', { name: identity.user.name })}</h1>
            <p>{t('polish.patientHint')}</p>
          </div>
        </header>
        <AccountDashboard identity={identity} refresh={refresh} />
      </main>
    );
  const counts = data
    ? [
        {
          label: staff ? t('polish.accessiblePatients') : t('polish.currentRecords'),
          value: staff ? data.patients.length : (data.portal?.records.length ?? 0),
          icon: Users,
        },
        { label: t('polish.today'), value: data.today.length, icon: CalendarDays },
        { label: t('polish.upcoming'), value: data.upcoming.length, icon: Clock3 },
        {
          label: t('polish.completed'),
          value: data.history.filter((item) => item.status === 'completed').length,
          icon: CheckCircle2,
        },
      ]
    : [];
  return (
    <main className="space-y-6">
      <header className="ui-page-header">
        <div>
          <h1>{t('polish.welcome', { name: identity.user.name })}</h1>
          <p>{t(staff ? 'polish.overviewHint' : 'polish.patientHint')}</p>
        </div>
        <button className="ui-btn-secondary" onClick={refreshOverview} disabled={loading}>
          {t('polish.refresh')}
        </button>
      </header>
      {loading && <PageState title={t('polish.loading')} loading />}
      {error && <PageState title={error} error retry={refreshOverview} />}
      {data && !loading && !error && (
        <>
          <div className="ui-metrics">
            {counts.map((card) => (
              <section key={card.label} className="ui-card ui-metric">
                <span className="ui-metric-icon">
                  <card.icon size={20} aria-hidden="true" />
                </span>
                <p className="ui-metric-label">{card.label}</p>
                <p className="ui-metric-value">{card.value}</p>
              </section>
            ))}
          </div>
          <p className="ui-caption">
            {t('polish.scope')} {staff && t('polish.patientScope')}
          </p>
          <section className="ui-card">
            <div className="ui-card-heading">
              <h2>{t('polish.quickActions')}</h2>
              <ArrowUpRight size={20} aria-hidden="true" />
            </div>
            <div className="ui-quick-actions">
              {!staff && (
                <Link className="ui-btn-secondary" to="/onboarding">
                  {t('admin.onboard')}
                </Link>
              )}
              <Link className="ui-btn-primary" to="/appointments">
                {t('ui.eefda2bfa8623a6a')}
              </Link>
              {dentist && (
                <>
                  <Link className="ui-btn-secondary" to="/clinical/patients">
                    {t('ui.794807d3934392d8')}
                  </Link>
                  <Link className="ui-btn-secondary" to="/imaging">
                    {t('polish.imaging')}
                  </Link>
                </>
              )}
              {staff ? (
                <Link className="ui-btn-secondary" to="/patients">
                  {t('polish.searchPatients')}
                </Link>
              ) : (
                <Link className="ui-btn-secondary" to="/clinical/history">
                  {t('ui.4db883d983b471bb')}
                </Link>
              )}
            </div>
          </section>
          <div className="ui-grid">
            <section className="ui-card">
              <div className="ui-card-heading">
                <h2>{t('polish.schedule')}</h2>
                <Link to="/appointments" className="text-indigo-700">
                  {t('ui.a1164b91bb0b2fad')}
                </Link>
              </div>
              {!data.upcoming.length ? (
                <PageState
                  title={t('polish.noSchedule')}
                  description={t('polish.noScheduleHint')}
                />
              ) : (
                data.upcoming.slice(0, 5).map((item) => (
                  <div className="ui-schedule-row" key={item.id}>
                    <time className="ui-schedule-time" dateTime={item.startsAt}>
                      {formatAppointmentTime(item.startsAt, item.timezone)}
                    </time>
                    <div className="ui-schedule-copy">
                      <strong>{item.typeName}</strong>
                      <p className="ui-caption">
                        {staff && item.patientName ? (
                          <bdi>{item.patientName}</bdi>
                        ) : (
                          item.locationName
                        )}
                      </p>
                    </div>
                    <StatusBadge value={item.status} />
                  </div>
                ))
              )}
            </section>
            <Suspense fallback={<PageState title={t('polish.loading')} loading />}>
              <AppointmentDistribution items={[...data.upcoming, ...data.history]} />
            </Suspense>
          </div>
          {staff && (
            <div className="ui-grid">
              <section className="ui-card">
                <div className="ui-card-heading">
                  <h2>{t('polish.accessiblePatients')}</h2>
                  <Link to="/patients" className="text-indigo-700">
                    {t('polish.patients')}
                  </Link>
                </div>
                {data.patients.slice(0, 5).map((patient) => (
                  <div className="ui-schedule-row" key={patient.id}>
                    <span className="ui-avatar" aria-hidden="true">
                      {patient.givenName.slice(0, 1)}
                    </span>
                    <div className="ui-schedule-copy">
                      <strong>
                        <bdi>
                          {patient.givenName} {patient.familyName}
                        </bdi>
                      </strong>
                      <p className="ui-caption">
                        <bdi>{patient.medicalRecordNumber}</bdi>
                      </p>
                    </div>
                    {dentist && (
                      <Link
                        to={`/clinical/patients?patient=${patient.id}`}
                        className="ui-btn-secondary"
                      >
                        {t('polish.openClinical')}
                      </Link>
                    )}
                  </div>
                ))}
                {!data.patients.length && <p className="ui-caption">{t('polish.noPatients')}</p>}
              </section>
              <section className="ui-card">
                <h2>{t('polish.finances')}</h2>
                <p className="ui-caption mt-2">{t('polish.receiptsHint')}</p>
                {data.report.map((row) => (
                  <div key={row.currency} className="ui-budget">
                    <bdi>{row.currency}</bdi>
                    <b>{showMoney(row.paymentsMinor, row.currency)}</b>
                    <span className="ui-caption">{t('polish.payments')}</span>
                    <span />
                    <span className="ui-caption">{t('polish.balance')}</span>
                    <b>{showMoney(row.balanceMinor, row.currency)}</b>
                  </div>
                ))}
                {!data.report.length && (
                  <p className="ui-caption py-4">{t('ui.182865eb7af255dd')}</p>
                )}
                <Link to="/billing" className="ui-btn-secondary mt-4">
                  {t('ui.334a67136be1afb3')}
                </Link>
              </section>
            </div>
          )}
          {data.administration && (
            <section className="ui-card">
              <div className="ui-card-heading">
                <h2>{t('polish.clinicCapacity')}</h2>
                <StatusBadge value={data.administration.subscription.effectiveState} />
              </div>
              <p className="ui-caption">{t('admin.provider')}</p>
              <div className="ui-grid mt-4">
                {(
                  [
                    [
                      'admin.seats',
                      data.administration.usage.seats,
                      data.administration.subscription.limits.seats,
                    ],
                    [
                      'admin.bookings',
                      data.administration.usage.appointments,
                      data.administration.subscription.limits.appointments,
                    ],
                  ] as const
                ).map(([key, value, maximum]) => (
                  <div className="ui-budget" key={key}>
                    <span>{t(key)}</span>
                    <bdi>
                      {value} / {maximum}
                    </bdi>
                    <progress value={value} max={maximum} aria-label={t(key)} />
                  </div>
                ))}
              </div>
              <Link to="/administration" className="ui-btn-secondary mt-4">
                {t('admin.title')}
              </Link>
            </section>
          )}
          {!!data.audit.length && (
            <section className="ui-card">
              <h2>{t('admin.audit')}</h2>
              {data.audit.slice(0, 4).map((event) => (
                <div key={event.id} className="ui-schedule-row">
                  <div className="ui-schedule-copy">
                    <bdi>{event.actorName}</bdi>
                    <p className="ui-caption">{event.action}</p>
                  </div>
                  <time dateTime={event.occurredAt}>{formatInstant(event.occurredAt)}</time>
                </div>
              ))}
            </section>
          )}
        </>
      )}
      <details
        id="account"
        className="ui-card"
        open={accountOpen || location.hash === '#account' || location.hash === '#team'}
        onToggle={(event) => setAccountOpen(event.currentTarget.open)}
      >
        <summary>{t('polish.account')}</summary>
        {(accountOpen || location.hash === '#account' || location.hash === '#team') && (
          <AccountDashboard identity={identity} refresh={refresh} />
        )}
      </details>
    </main>
  );
}
