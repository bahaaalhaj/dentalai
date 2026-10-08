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
      setError(e instanceof Error ? e.message : 'Pricing unavailable.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bg-white rounded-2xl p-5 border space-y-3">
      <h2 className="font-bold">Services and price snapshots</h2>
      <p>
        Published prices are immutable. Publish a new snapshot for future drafts; issued invoice
        amounts never change with prices.
      </p>
      {!catalog.priceLists.length && <p>No published price lists.</p>}
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
            aria-label="New service"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void apply(() => apiClient.createBillingService({ code, name: serviceName, reason }));
            }}
          >
            <Field label="Service code" value={code} onChange={setCode} required />
            <Field label="Service name" value={serviceName} onChange={setServiceName} required />
            <Field label="Pricing reason" value={reason} onChange={setReason} required />
            <button disabled={busy}>Create service</button>
          </form>
          <form
            aria-label="Publish prices"
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
            <Field label="Price list name" value={name} required onChange={setName} />
            <Field
              label="Currency code"
              value={currency}
              required
              onChange={(v) => setCurrency(v.toUpperCase())}
            />
            {catalog.services
              .filter((s) => s.active)
              .map((s) => (
                <Field
                  key={s.id}
                  label={`Price for ${s.name}`}
                  value={amounts[s.id] ?? ''}
                  onChange={(v) => setAmounts({ ...amounts, [s.id]: v })}
                />
              ))}
            <button disabled={busy}>Publish price snapshot</button>
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
