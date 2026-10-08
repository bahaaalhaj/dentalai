import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  BillingCatalog,
  BillingInvoice,
  BillingLinksSchema,
  BillingReportSchema,
} from '@dentalai/contracts';
import type { z } from 'zod';
import { apiClient } from '../lib/api-client';
import { InvoiceEditor } from './InvoiceEditor';
import { PaymentDialog, type FinancialAction } from './PaymentDialog';
import { PricingPanel } from './PricingPanel';
import { FinancialHistory } from './FinancialHistory';
import { showMoney } from './Money';
export function BillingPage({ portal = false }: { portal?: boolean }) {
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null),
    [invoices, setInvoices] = useState<BillingInvoice[]>([]),
    [reports, setReports] = useState<z.infer<typeof BillingReportSchema>>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [receipt, setReceipt] = useState<string | null>(null),
    [selected, setSelected] = useState(''),
    [editor, setEditor] = useState<BillingInvoice | null | undefined>(undefined),
    [links, setLinks] = useState<z.infer<typeof BillingLinksSchema>>([]),
    [action, setAction] = useState<FinancialAction | null>(null);
  const sequence = useRef(Symbol('billing'));
  const linkSequence = useRef(Symbol('links'));
  const refresh = useCallback(async () => {
    const current = Symbol('billing');
    sequence.current = current;
    setLoading(true);
    setError('');
    try {
      const data = await apiClient.billingInvoices(portal);
      if (current !== sequence.current) return;
      setInvoices(data);
      if (!portal) {
        const [cat, report] = await Promise.all([
          apiClient.billingCatalog(),
          apiClient.billingReports(),
        ]);
        if (current !== sequence.current) return;
        setCatalog(cat);
        setReports(report);
      }
    } catch (e) {
      if (current === sequence.current)
        setError(e instanceof Error ? e.message : 'Billing unavailable.');
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [portal]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current = Symbol('discard unmounted billing');
      linkSequence.current = Symbol('discard links');
    };
  }, [refresh]);
  const invoice = invoices.find((i) => i.id === selected);
  return (
    <main className="bg-slate-50 min-h-screen p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <Link to="/dashboard" className="text-indigo-600">
          DentalAI · Account
        </Link>
        <h1 className="text-3xl font-bold">
          {portal ? 'Your invoices and receipts' : 'Clinic billing ledger'}
        </h1>
        <p>
          Financial history comes from issued invoices and immutable events, never current tooth
          status. {portal ? 'Read-only permitted financial information.' : ''}
        </p>
        <button disabled={editor !== undefined || action !== null} onClick={() => void refresh()}>
          Refresh billing
        </button>
        {loading && <p role="status">Loading billing…</p>}
        {error && (
          <p role="alert" className="text-red-700">
            {error} <button onClick={() => void refresh()}>Retry</button>
          </p>
        )}
        {receipt && (
          <p role="status" className="bg-emerald-50 p-4 break-all">
            Recorded receipt: {receipt}
          </p>
        )}
        {!loading && !invoices.length && <p>No {portal ? 'issued ' : ''}invoices available.</p>}
        {!portal && catalog && (
          <>
            <PricingPanel catalog={catalog} refresh={refresh} />
            <section className="bg-white border rounded-2xl p-5">
              <h2 className="font-bold">Issued invoice and payment reports</h2>
              {!reports.length && <p>No issued financial activity.</p>}
              {reports.map((r) => (
                <p key={r.currency}>
                  {r.currency} · {r.invoiceCount} invoices · Issued{' '}
                  {showMoney(r.issuedMinor, r.currency)} · Adjustments{' '}
                  {showMoney(r.adjustmentMinor, r.currency)} · Payments{' '}
                  {showMoney(r.paymentsMinor, r.currency)} · Refunds{' '}
                  {showMoney(r.refundsMinor, r.currency)} · Open{' '}
                  {showMoney(r.balanceMinor, r.currency)}
                </p>
              ))}
            </section>
            {catalog.permissions.write && (
              <button
                disabled={editor !== undefined || action !== null}
                className="bg-indigo-600 text-white p-3 rounded-xl"
                onClick={() => {
                  linkSequence.current = Symbol('new invoice');
                  setEditor(null);
                  setLinks([]);
                }}
              >
                New invoice
              </button>
            )}
          </>
        )}
        <label>
          Invoice
          <select
            aria-label="Invoice"
            disabled={editor !== undefined || action !== null}
            className="w-full p-3 border rounded-xl"
            value={selected}
            onChange={(e) => {
              linkSequence.current = Symbol('selected invoice');
              setSelected(e.target.value);
              setEditor(undefined);
              setAction(null);
              setLinks([]);
            }}
          >
            <option value="">Select invoice</option>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoiceNumber} · {i.status} · {showMoney(i.balanceMinor, i.currency)}
              </option>
            ))}
          </select>
        </label>
        {editor !== undefined && catalog && (
          <InvoiceEditor
            key={editor?.id ?? 'new'}
            catalog={catalog}
            invoice={editor}
            links={links}
            cancel={() => setEditor(undefined)}
            saved={async () => {
              setEditor(undefined);
              await refresh();
            }}
          />
        )}
        {invoice && (
          <section className="bg-white border rounded-2xl p-5 space-y-3">
            <h2 className="font-bold">
              {invoice.invoiceNumber} · {invoice.status}
            </h2>
            <p>
              Original {showMoney(invoice.originalTotalMinor, invoice.currency)} · Adjusted{' '}
              {showMoney(invoice.adjustedTotalMinor, invoice.currency)} · Paid{' '}
              {showMoney(invoice.paymentsMinor, invoice.currency)} · Refunded{' '}
              {showMoney(invoice.refundsMinor, invoice.currency)} · Remaining{' '}
              {showMoney(invoice.balanceMinor, invoice.currency)}
            </p>
            {invoice.items.map((i) => (
              <p key={i.id}>
                {i.description} · quantity {i.quantityHundredths / 100} ·{' '}
                {showMoney(i.lineTotalMinor, invoice.currency)}
              </p>
            ))}
            {!portal && catalog?.permissions.write && invoice.status === 'draft' && (
              <div className="flex gap-4">
                <button
                  disabled={editor !== undefined}
                  onClick={() => {
                    const current = Symbol('invoice links');
                    linkSequence.current = current;
                    setEditor(invoice);
                    void apiClient
                      .billingLinks(invoice.patientId)
                      .then((data) => {
                        if (linkSequence.current === current) setLinks(data);
                      })
                      .catch((e: unknown) => {
                        if (linkSequence.current === current)
                          setError(e instanceof Error ? e.message : 'Link references unavailable.');
                      });
                  }}
                >
                  Edit draft
                </button>
                <button disabled={editor !== undefined} onClick={() => setAction('issue')}>
                  Issue invoice
                </button>
                <button disabled={editor !== undefined} onClick={() => setAction('discard')}>
                  Discard draft
                </button>
              </div>
            )}
            {!portal &&
              catalog?.permissions.write &&
              !['draft', 'discarded'].includes(invoice.status) && (
                <button onClick={() => setAction('payment')}>Record payment</button>
              )}
            {!portal &&
              catalog?.permissions.manage &&
              !['draft', 'discarded'].includes(invoice.status) && (
                <div className="flex gap-4">
                  <button onClick={() => setAction('refund')}>Refund payment</button>
                  <button onClick={() => setAction('adjustment')}>Adjust invoice</button>
                </div>
              )}
            <FinancialHistory invoice={invoice} />
          </section>
        )}
        {invoice && action && (
          <PaymentDialog
            key={`${invoice.id}:${action}`}
            invoice={invoice}
            action={action}
            close={() => setAction(null)}
            saved={async (reference) => {
              setAction(null);
              setReceipt(reference);
              await refresh();
            }}
          />
        )}
      </div>
    </main>
  );
}
