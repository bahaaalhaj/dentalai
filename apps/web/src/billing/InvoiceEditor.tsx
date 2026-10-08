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
      aria-label="Invoice draft"
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
      <h2 className="font-bold">{invoice ? 'Replace draft lines' : 'New invoice draft'}</h2>
      {invoice && (
        <p>
          The current lines remain in audit history. Replace the entire draft explicitly; issued
          invoices cannot be edited.
        </p>
      )}
      <fieldset disabled={busy || locked} className="space-y-4">
        <label>
          Invoice patient
          <select
            aria-label="Invoice patient"
            disabled={!!invoice || busy}
            className="w-full border p-3 rounded-xl"
            value={patientId}
            onChange={(e) => {
              setPatientId(e.target.value);
              setLines(lines.map((l) => ({ ...l, procedureId: '', treatmentPlanItemId: '' })));
            }}
          >
            <option value="">Select patient</option>
            {catalog.patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.givenName} {p.familyName} · {p.medicalRecordNumber}
              </option>
            ))}
          </select>
        </label>
        <label>
          Price list
          <select
            aria-label="Price list"
            className="w-full border p-3 rounded-xl"
            value={listId}
            onChange={(e) => {
              setListId(e.target.value);
              setLines([empty()]);
            }}
          >
            <option value="">Select price snapshot</option>
            {catalog.priceLists
              .filter((l) => !invoice || l.currency === invoice.currency)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} · {l.currency}
                </option>
              ))}
          </select>
        </label>
        {!catalog.priceLists.length && (
          <p>No published prices. An owner/admin must publish a price list first.</p>
        )}
        {lines.map((l, index) => (
          <fieldset key={index} className="border rounded-xl p-3 space-y-3">
            <legend>Invoice line {index + 1}</legend>
            <label>
              Service
              <select
                aria-label={`Line ${index + 1} service`}
                value={l.priceItemId}
                className="w-full border p-3"
                onChange={(e) =>
                  setLines(
                    lines.map((v, i) => (i === index ? { ...v, priceItemId: e.target.value } : v)),
                  )
                }
              >
                <option value="">Select service price</option>
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
                label={`Line ${index + 1} ${field === 'quantity' ? 'quantity in hundredths' : `${field} in minor units`}`}
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
                Line {index + 1}{' '}
                {field === 'procedureId' ? 'performed procedure' : 'treatment-plan item'} (optional)
                <select
                  aria-label={`Line ${index + 1} ${field === 'procedureId' ? 'performed procedure' : 'treatment-plan item'} (optional)`}
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
                  <option value="">No clinical link</option>
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
                Remove draft line {index + 1}
              </button>
            )}
          </fieldset>
        ))}
        {linkLoading && <p role="status">Loading approved link references…</p>}
        {linkError && (
          <p role="alert">
            {linkError}{' '}
            <button type="button" onClick={() => setLinkRetry((v) => v + 1)}>
              Retry clinical references
            </button>
          </p>
        )}
        {!!references.length && (
          <details>
            <summary>Approved billing link references for selected invoice</summary>
            {references.map((l) => (
              <p key={l.id}>
                {l.kind}: {l.description} · {l.id}
              </p>
            ))}
          </details>
        )}
        <p className="text-sm">
          100 hundredths = one unit. Discount and tax are explicit minor-unit amounts, not
          automatically calculated tax advice. Prices come from the server.
        </p>
        <button type="button" onClick={() => setLines([...lines, empty()])}>
          Add invoice line
        </button>
        <Field label="Draft change reason" value={reason} required onChange={setReason} />
      </fieldset>
      {error && (
        <p role="alert" className="text-red-700">
          {error} Draft retained. Retry the same request after checking invoice history.
        </p>
      )}
      <div className="flex gap-4">
        <button disabled={busy} className="bg-indigo-600 text-white p-3 rounded-xl">
          Save invoice draft
        </button>
        <button type="button" disabled={busy} onClick={cancel}>
          Cancel draft editor
        </button>
      </div>
    </form>
  );
}
