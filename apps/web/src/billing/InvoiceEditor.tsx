import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import {
  InvoiceWriteSchema,
  type BillingCatalog,
  type BillingInvoice,
  type BillingLinksSchema,
} from '@dentalai/contracts';
import { apiClient } from '../lib/api-client';
import { Field } from '../clinical/ClinicalFields';
import { showMoney } from './Money';
type Line = {
  priceItemId: string;
  quantity: string;
  discount: string;
  tax: string;
  procedureId: string;
  treatmentPlanItemId: string;
};
const empty = (): Line => ({
  priceItemId: '',
  quantity: '100',
  discount: '0',
  tax: '0',
  procedureId: '',
  treatmentPlanItemId: '',
});
export function InvoiceEditor({
  catalog,
  invoice,
  links,
  saved,
  cancel,
}: {
  catalog: BillingCatalog;
  invoice: BillingInvoice | null;
  links: z.infer<typeof BillingLinksSchema>;
  saved: () => Promise<void>;
  cancel: () => void;
}) {
  const [patientId, setPatientId] = useState(invoice?.patientId ?? ''),
    [listId, setListId] = useState(''),
    [lines, setLines] = useState<Line[]>([empty()]),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false),
    [requestKey] = useState(() => crypto.randomUUID());
  const list = catalog.priceLists.find((l) => l.id === listId);
  const [patientLinks, setPatientLinks] = useState<z.infer<typeof BillingLinksSchema>>([]);
  const [linkError, setLinkError] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkRetry, setLinkRetry] = useState(0);
  useEffect(() => {
    if (invoice || !patientId) return;
    let active = true;
    setPatientLinks([]);
    setLinkError('');
    setLinkLoading(true);
    void apiClient
      .billingLinks(patientId)
      .then((data) => {
        if (active) setPatientLinks(data);
      })
      .catch((e: unknown) => {
        if (active)
          setLinkError(e instanceof Error ? e.message : 'Clinical link references unavailable.');
      })
      .finally(() => {
        if (active) setLinkLoading(false);
      });
    return () => {
      active = false;
    };
  }, [invoice, patientId, linkRetry]);
  const references = invoice ? links : patientLinks;
  return (
    <form
      aria-label={t('ui.cb52180db8ec24e7')}
      className="bg-white border rounded-2xl p-5 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        try {
          const body = InvoiceWriteSchema.parse({
            patientId,
            priceListId: listId,
            reason,
            requestKey,
            items: lines.map((l) => ({
              priceItemId: l.priceItemId,
              quantityHundredths: /^\d+$/.test(l.quantity) ? Number(l.quantity) : NaN,
              discountMinor: /^\d+$/.test(l.discount) ? Number(l.discount) : NaN,
              taxMinor: /^\d+$/.test(l.tax) ? Number(l.tax) : NaN,
              procedureId: l.procedureId || null,
              treatmentPlanItemId: l.treatmentPlanItemId || null,
            })),
          });
          setBusy(true);
          setLocked(true);
          if (invoice)
            await apiClient.reviseInvoice(invoice.id, {
              priceListId: body.priceListId,
              items: body.items,
              reason,
              requestKey,
              expectedVersion: invoice.version,
            });
          else await apiClient.createInvoice(body);
          await saved();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Unable to save draft.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="font-bold">{invoice ? t('ui.66ef630a6f03c5f5') : t('ui.a03c1bf1c31ec25f')}</h2>
      {invoice && <p>{t('ui.8234a10f43d9b352')}</p>}
      <fieldset disabled={busy || locked} className="space-y-4">
        <label>
          {t('ui.5546233a5f6ef106')}
          <select
            aria-label={t('ui.5546233a5f6ef106')}
            disabled={!!invoice || busy}
            className="w-full border p-3 rounded-xl"
            value={patientId}
            onChange={(e) => {
              setPatientId(e.target.value);
              setLines(lines.map((l) => ({ ...l, procedureId: '', treatmentPlanItemId: '' })));
            }}
          >
            <option value="">{t('ui.36512653e9fdc43c')}</option>
            {catalog.patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.givenName} {p.familyName} · {p.medicalRecordNumber}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('ui.577b5c6442537dcb')}
          <select
            aria-label={t('ui.577b5c6442537dcb')}
            className="w-full border p-3 rounded-xl"
            value={listId}
            onChange={(e) => {
              setListId(e.target.value);
              setLines([empty()]);
            }}
          >
            <option value="">{t('ui.70bab3d67b89686d')}</option>
            {catalog.priceLists
              .filter((l) => !invoice || l.currency === invoice.currency)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} · {l.currency}
                </option>
              ))}
          </select>
        </label>
        {!catalog.priceLists.length && <p>{t('ui.32c8ddca764c6adc')}</p>}
        {lines.map((l, index) => (
          <fieldset key={index} className="border rounded-xl p-3 space-y-3">
            <legend>
              {t('ui.dffd370b53aad452')}
              {index + 1}
            </legend>
            <label>
              {t('ui.d677190e0a9990e7')}
              <select
                aria-label={t('ui.f64c8c18ac7b4797', { v0: index + 1 })}
                value={l.priceItemId}
                className="w-full border p-3"
                onChange={(e) =>
                  setLines(
                    lines.map((v, i) => (i === index ? { ...v, priceItemId: e.target.value } : v)),
                  )
                }
              >
                <option value="">{t('ui.f1cde6e8a1f9a1d5')}</option>
                {list?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.serviceName} · {showMoney(p.amountMinor, list.currency)}
                  </option>
                ))}
              </select>
            </label>
            {(['quantity', 'discount', 'tax'] as const).map((field) => (
              <Field
                key={field}
                label={t('ui.7ee8b33a67ec4f74', {
                  v0: index + 1,
                  v1: field === 'quantity' ? 'quantity in hundredths' : `${field} in minor units`,
                })}
                value={l[field]}
                required
                type="text"
                onChange={(v) =>
                  setLines(lines.map((line, i) => (i === index ? { ...line, [field]: v } : line)))
                }
              />
            ))}
            {(['procedureId', 'treatmentPlanItemId'] as const).map((field) => (
              <label key={field}>
                {t('ui.adc6295a3f2de663')}
                {index + 1}{' '}
                {field === 'procedureId' ? t('ui.cbdf6bd0124e9275') : t('ui.dbe752b2fa2f213b')}{' '}
                {t('ui.0059798b7f7023e4')}
                <select
                  aria-label={t('ui.72ca7a9cce317895', {
                    v0: index + 1,
                    v1: field === 'procedureId' ? 'performed procedure' : 'treatment-plan item',
                  })}
                  value={l[field]}
                  className="w-full border p-3"
                  onChange={(e) =>
                    setLines(
                      lines.map((line, i) =>
                        i === index ? { ...line, [field]: e.target.value } : line,
                      ),
                    )
                  }
                >
                  <option value="">{t('ui.7a7f7dadad755457')}</option>
                  {references
                    .filter(
                      (ref) => ref.kind === (field === 'procedureId' ? 'procedure' : 'plan_item'),
                    )
                    .map((ref) => (
                      <option key={ref.id} value={ref.id}>
                        {ref.description} · {ref.id}
                      </option>
                    ))}
                </select>
              </label>
            ))}
            {lines.length > 1 && (
              <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))}>
                {t('ui.6051442d201e4745')}
                {index + 1}
              </button>
            )}
          </fieldset>
        ))}
        {linkLoading && <p role="status">{t('ui.6a3a953f24964555')}</p>}
        {linkError && (
          <p role="alert">
            {linkError}{' '}
            <button type="button" onClick={() => setLinkRetry((v) => v + 1)}>
              {t('ui.03e675a5956411e2')}
            </button>
          </p>
        )}
        {!!references.length && (
          <details>
            <summary>{t('ui.470901ae90dc7d0f')}</summary>
            {references.map((l) => (
              <p key={l.id}>
                {l.kind}: {l.description} · {l.id}
              </p>
            ))}
          </details>
        )}
        <p className="text-sm">{t('ui.f2836b72514b34be')}</p>
        <button type="button" onClick={() => setLines([...lines, empty()])}>
          {t('ui.c5e8a6d06a5c98c1')}
        </button>
        <Field label={t('ui.40f62b6cfeb78efd')} value={reason} required onChange={setReason} />
      </fieldset>
      {error && (
        <p role="alert" className="text-red-700">
          {error} {t('ui.ba1e2b79c3957b99')}
        </p>
      )}
      <div className="flex gap-4">
        <button disabled={busy} className="bg-indigo-600 text-white p-3 rounded-xl">
          {t('ui.c8f14d945e83b6d2')}
        </button>
        <button type="button" disabled={busy} onClick={cancel}>
          {t('ui.22877781479384ae')}
        </button>
      </div>
    </form>
  );
}
