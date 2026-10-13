import { t } from '../i18n';
import { getErrorMessage } from '../lib/errors';
import { useState } from 'react';
import type { BillingCatalog } from '@dentalai/contracts';
import { apiClient } from '../lib/api-client';
import { Field } from '../clinical/ClinicalFields';
import { inputMinor, showMoney } from './Money';
export function PricingPanel({
  catalog,
  refresh,
}: {
  catalog: BillingCatalog;
  refresh: () => Promise<void>;
}) {
  const [name, setName] = useState(''),
    [serviceName, setServiceName] = useState(''),
    [code, setCode] = useState(''),
    [currency, setCurrency] = useState('USD'),
    [amounts, setAmounts] = useState<Record<string, string>>({}),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const apply = async (operation: () => Promise<unknown>) => {
    setError('');
    setBusy(true);
    try {
      await operation();
      await refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bg-white rounded-2xl p-5 border space-y-3">
      <h2 className="font-bold">{t('ui.210112942b1db51e')}</h2>
      <p>{t('ui.1c8b626a0957db18')}</p>
      {!catalog.priceLists.length && <p>{t('ui.ca25e5c5bcd7be02')}</p>}
      {catalog.priceLists.map((l) => (
        <details key={l.id}>
          <summary>
            {l.name} · {l.currency}
          </summary>
          {l.items.map((i) => (
            <p key={i.id}>
              {i.serviceName}: {showMoney(i.amountMinor, l.currency)}
            </p>
          ))}
        </details>
      ))}
      {catalog.permissions.manage && (
        <>
          <form
            aria-label={t('ui.d26771c602ff260f')}
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void apply(() => apiClient.createBillingService({ code, name: serviceName, reason }));
            }}
          >
            <Field label={t('ui.71f46b401d97678c')} value={code} onChange={setCode} required />
            <Field
              label={t('ui.1bb8870cc0750b9e')}
              value={serviceName}
              onChange={setServiceName}
              required
            />
            <Field label={t('ui.4563226313cf3d1c')} value={reason} onChange={setReason} required />
            <button disabled={busy}>{t('ui.fea376f9df857d8b')}</button>
          </form>
          <form
            aria-label={t('ui.9710df38427b5d28')}
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void apply(() =>
                apiClient.publishPrices({
                  name,
                  currency,
                  reason,
                  items: catalog.services
                    .filter((s) => s.active && amounts[s.id] !== undefined && amounts[s.id] !== '')
                    .map((s) => ({
                      serviceId: s.id,
                      amountMinor: inputMinor(amounts[s.id]!, currency),
                    })),
                }),
              );
            }}
          >
            <Field label={t('ui.19c26e50313a41ad')} value={name} required onChange={setName} />
            <Field
              label={t('ui.378b65e1226022ba')}
              value={currency}
              required
              onChange={(v) => setCurrency(v.toUpperCase())}
            />
            {catalog.services
              .filter((s) => s.active)
              .map((s) => (
                <Field
                  key={s.id}
                  label={t('ui.a50ca63282f81d07', { v0: s.name })}
                  value={amounts[s.id] ?? ''}
                  onChange={(v) => setAmounts({ ...amounts, [s.id]: v })}
                />
              ))}
            <button disabled={busy}>{t('ui.dba03f063afb7aca')}</button>
          </form>
        </>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
