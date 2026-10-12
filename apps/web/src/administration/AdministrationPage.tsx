import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { z } from 'zod';
import type {
  AuthIdentity,
  AdministrationOverviewSchema,
  PlanSchema,
  AuditSummarySchema,
  NotificationHistorySchema,
} from '@dentalai/contracts';
import { apiClient } from '../lib/api-client';
import { getErrorMessage } from '../lib/errors';
import { t } from '../i18n';
import { ClinicFields } from './ClinicFields';
import type { ClinicFieldsValue } from './initial-clinic';
import { Field } from '../clinical/ClinicalFields';
import { MembershipPanel } from './MembershipPanel';
import { ExportPanel } from './ExportPanel';
import { LocationPanel } from './LocationPanel';
export function AdministrationPage({
  identity,
  refreshIdentity,
}: {
  identity: AuthIdentity;
  refreshIdentity: () => Promise<void>;
}) {
  const [data, setData] = useState<z.infer<typeof AdministrationOverviewSchema> | null>(null),
    [plans, setPlans] = useState<z.infer<typeof PlanSchema>[]>([]),
    [audit, setAudit] = useState<z.infer<typeof AuditSummarySchema>>([]),
    [history, setHistory] = useState<z.infer<typeof NotificationHistorySchema>>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [reason, setReason] = useState(''),
    [operational, setOperational] = useState(true);
  const owner = identity.activeMembership?.roles.includes('clinic_owner') ?? false;
  const refresh = useCallback(async () => {
    const [overview, catalog, notifications, preferences, audits] = await Promise.all([
      apiClient.administration(),
      apiClient.plans(),
      apiClient.notificationHistory(),
      apiClient.notificationPreferences(),
      owner ? apiClient.administrationAudit() : Promise.resolve([]),
    ]);
    setData(overview);
    setPlans(catalog);
    setHistory(notifications);
    setOperational(preferences.operationalEmail);
    setAudit(audits);
  }, [owner]);
  useEffect(() => {
    let active = true;
    refresh()
      .catch((error) => {
        if (active) setError(getErrorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  const apply = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await operation();
      await refresh();
      await refreshIdentity();
      setMessage(t('admin.saved'));
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  if (loading)
    return (
      <main className="p-6" role="status">
        {t('admin.loading')}
      </main>
    );
  if (!data)
    return (
      <main className="p-6">
        <p role="alert">{error}</p>
        <button onClick={() => window.location.reload()}>{t('admin.retry')}</button>
      </main>
    );
  const configuration = data.configuration,
    subscription = data.subscription;
  return (
    <main className="min-h-screen bg-slate-50 p-6 pb-24">
      <div className="max-w-5xl mx-auto space-y-5">
        <Link to="/dashboard">{t('admin.home')}</Link>
        <header className="flex items-center gap-4">
          <span
            style={{ backgroundColor: configuration.brandColor }}
            className="text-white p-3 rounded-xl"
          >
            <bdi>{configuration.brandMark}</bdi>
          </span>
          <div>
            <h1 className="text-2xl font-bold">{t('admin.title')}</h1>
            <p>
              <bdi>{configuration.displayName}</bdi>
            </p>
          </div>
        </header>
        {error && (
          <p role="alert" className="p-3 bg-red-50 rounded-xl">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <Profile key={configuration.version} value={configuration} busy={busy} apply={apply} />
        <section className="bg-white border p-5 rounded-2xl space-y-3">
          <h2 className="font-bold">{t('admin.plan')}</h2>
          <p>{t('admin.provider')}</p>
          <p>
            {subscription.planCode} · {subscription.effectiveState} · {subscription.state}
          </p>
          {subscription.periodEnd && <p>{new Date(subscription.periodEnd).toLocaleString()}</p>}
          {!subscription.growthAllowed && <p role="status">{t('admin.readOnly')}</p>}
          <Field label={t('admin.reason')} value={reason} onChange={setReason} required />
          {plans.map((plan) => (
            <div key={plan.code} className="border rounded-xl p-3">
              <b>{plan.name}</b>
              <p>
                {t('admin.seats')}: {plan.limits.seats} · {t('admin.locations')}:{' '}
                {plan.limits.locations} · {t('admin.bookings')}: {plan.limits.appointments} ·{' '}
                {t('admin.storage')}: {plan.limits.storageBytes}
              </p>
              {owner && (
                <button
                  disabled={busy || reason.trim().length < 3}
                  onClick={() =>
                    void apply(() =>
                      apiClient.subscriptionAction({
                        action: 'request_plan',
                        planCode: plan.code === 'team' ? 'team' : 'starter',
                        version: subscription.version,
                        reason,
                      }),
                    )
                  }
                >
                  {t('admin.requestPlan')}
                </button>
              )}
            </div>
          ))}
          {subscription.requestedPlan && (
            <p>
              {t('admin.requestPlan')}: {subscription.requestedPlan}
            </p>
          )}
          {owner && (
            <button
              disabled={busy || reason.trim().length < 3}
              onClick={() =>
                void apply(() =>
                  apiClient.subscriptionAction({
                    action: subscription.cancelAtPeriodEnd ? 'resume' : 'cancel',
                    version: subscription.version,
                    reason,
                  }),
                )
              }
            >
              {subscription.cancelAtPeriodEnd ? t('admin.resumePlan') : t('admin.cancelPlan')}
            </button>
          )}
        </section>
        <section className="bg-white border rounded-2xl p-5 space-y-2">
          <h2 className="font-bold">{t('admin.usage')}</h2>
          <p dir="ltr">
            {data.usage.period} {t('ui.7e5f76c94a635c21')}
          </p>
          <dl className="grid sm:grid-cols-2 gap-3">
            {(
              [
                ['admin.seats', data.usage.seats, subscription.limits.seats],
                ['admin.locations', data.usage.locations, subscription.limits.locations],
                ['admin.bookings', data.usage.appointments, subscription.limits.appointments],
                ['admin.storage', data.usage.storageBytes, subscription.limits.storageBytes],
              ] as const
            ).map(([label, value, maximum]) => (
              <div key={label}>
                <dt>{t(label)}</dt>
                <dd dir="ltr">
                  {value} / {maximum}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <MembershipPanel
          members={data.members}
          self={identity.activeMembership!.id}
          owner={owner}
          busy={busy}
          apply={(id, body) => apply(() => apiClient.changeMember(id, body))}
        />
        <LocationPanel
          locations={data.locations}
          timezone={configuration.timezone}
          busy={busy}
          save={(body) => apply(() => apiClient.saveLocation(body))}
        />
        <section className="bg-white border rounded-2xl p-5 space-y-3">
          <nav className="flex flex-wrap gap-4">
            <Link to="/appointments">{t('admin.hours')}</Link>
            <Link to="/billing">{t('admin.services')}</Link>
            <Link to="/dashboard">{t('admin.invitations')}</Link>
          </nav>
        </section>
        <section className="bg-white border rounded-2xl p-5 space-y-3">
          <h2 className="font-bold">{t('admin.preferences')}</h2>
          <label>
            <input
              type="checkbox"
              checked={operational}
              disabled={busy}
              onChange={(e) =>
                void apply(() => apiClient.notificationPreferences(e.target.checked))
              }
            />{' '}
            {t('admin.emailPreference')}
          </label>
          <p>{t('admin.requiredEmails')}</p>
          <h2 className="font-bold">{t('admin.notifications')}</h2>
          <p>{t('admin.accepted')}</p>
          {!history.length && <p>{t('admin.empty')}</p>}
          {history.map((item) => (
            <p key={item.id}>
              <bdi>{item.recipient}</bdi> · {item.category} · {item.state} · {item.attempts} ·{' '}
              {new Date(item.createdAt).toLocaleString()}
            </p>
          ))}
        </section>
        {owner && (
          <>
            <section className="bg-white border rounded-2xl p-5 space-y-3">
              <h2 className="font-bold">{t('admin.audit')}</h2>
              {!audit.length && <p>{t('admin.empty')}</p>}
              {audit.map((event) => (
                <p key={event.id}>
                  <bdi>{event.actorName}</bdi> · {event.action} ·{' '}
                  {new Date(event.occurredAt).toLocaleString()}
                </p>
              ))}
            </section>
            <ExportPanel name={configuration.displayName} busy={busy} apply={apply} />
          </>
        )}
      </div>
    </main>
  );
}
function Profile({
  value,
  busy,
  apply,
}: {
  value: ClinicFieldsValue & { version: number };
  busy: boolean;
  apply: (operation: () => Promise<unknown>) => Promise<void>;
}) {
  const [configuration, setConfiguration] = useState<ClinicFieldsValue>({
      legalName: value.legalName,
      displayName: value.displayName,
      currency: value.currency,
      timezone: value.timezone,
      locale: value.locale,
      contactEmail: value.contactEmail,
      contactPhone: value.contactPhone,
      brandColor: value.brandColor,
      brandMark: value.brandMark,
    }),
    [reason, setReason] = useState('');
  return (
    <section className="bg-white border rounded-2xl p-5 space-y-3">
      <h2 className="font-bold">{t('admin.profile')}</h2>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void apply(() =>
            apiClient.configureClinic({ ...configuration, version: value.version, reason }),
          );
        }}
      >
        <ClinicFields value={configuration} onChange={setConfiguration} />
        <Field label={t('admin.reason')} value={reason} onChange={setReason} required />
        <button
          className="bg-indigo-600 text-white px-5 py-3 rounded-xl disabled:opacity-50"
          disabled={busy || reason.trim().length < 3}
        >
          {t('admin.save')}
        </button>
      </form>
    </section>
  );
}
