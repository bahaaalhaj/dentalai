import { t } from '../i18n';
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
          {t('ui.5da1476388be416f')}
        </Link>
        <h1 className="text-3xl font-bold">
          {portal ? t('ui.e0d166dca6b8ae62') : t('ui.7e6562a764190dfc')}
        </h1>
        <p>
          {t('ui.19b38f0396816d88')}
          {portal ? t('ui.0f1ca410797c56a4') : ''}
        </p>
        <button disabled={editor !== undefined || action !== null} onClick={() => void refresh()}>
          {t('ui.bdb64a9f7e2332f4')}
        </button>
        {loading && <p role="status">{t('ui.2c8af4d4106d408c')}</p>}
        {error && (
          <p role="alert" className="text-red-700">
            {error} <button onClick={() => void refresh()}>{t('ui.942087cc2d41e013')}</button>
          </p>
        )}
        {receipt && (
          <p role="status" className="bg-emerald-50 p-4 break-all">
            {t('ui.a7050f20bbe5af52')}
            {receipt}
          </p>
        )}
        {!loading && !invoices.length && (
          <p>
            {t('ui.05f8bb36f8813cd8')}
            {portal ? t('ui.80f24ee2af7c474c') : ''}
            {t('ui.12e27867eb5c9926')}
          </p>
        )}
        {!portal && catalog && (
          <>
            <PricingPanel catalog={catalog} refresh={refresh} />
            <section className="bg-white border rounded-2xl p-5">
              <h2 className="font-bold">{t('ui.0a49928d7e40e7c2')}</h2>
              {!reports.length && <p>{t('ui.182865eb7af255dd')}</p>}
              {reports.map((r) => (
                <p key={r.currency}>
                  {r.currency} · {r.invoiceCount} {t('ui.4c7e116e90017a10')}{' '}
                  {showMoney(r.issuedMinor, r.currency)} {t('ui.fc4d6342d36923c6')}{' '}
                  {showMoney(r.adjustmentMinor, r.currency)} {t('ui.d3758801a6cdb883')}{' '}
                  {showMoney(r.paymentsMinor, r.currency)} {t('ui.a4a8c46199d080bd')}{' '}
                  {showMoney(r.refundsMinor, r.currency)} {t('ui.a16474bbce3b4332')}{' '}
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
                {t('ui.84918c66a9d7fc7e')}
              </button>
            )}
          </>
        )}
        <label>
          {t('ui.b832002da297545f')}
          <select
            aria-label={t('ui.b832002da297545f')}
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
            <option value="">{t('ui.81d75c961d178c6a')}</option>
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
              {t('ui.9feb5fc023004901')}
              {showMoney(invoice.originalTotalMinor, invoice.currency)} {t('ui.9d64568c68311f9f')}{' '}
              {showMoney(invoice.adjustedTotalMinor, invoice.currency)} {t('ui.b15892cd67d0079c')}{' '}
              {showMoney(invoice.paymentsMinor, invoice.currency)} {t('ui.a8532b82397e2bdb')}{' '}
              {showMoney(invoice.refundsMinor, invoice.currency)} {t('ui.b266aaace53d0524')}{' '}
              {showMoney(invoice.balanceMinor, invoice.currency)}
            </p>
            {invoice.items.map((i) => (
              <p key={i.id}>
                {i.description} {t('ui.db84fd58edf34e24')}
                {i.quantityHundredths / 100} · {showMoney(i.lineTotalMinor, invoice.currency)}
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
                  {t('ui.4452cbdbee0f5f51')}
                </button>
                <button disabled={editor !== undefined} onClick={() => setAction('issue')}>
                  {t('ui.3d669c085f9a2c43')}
                </button>
                <button disabled={editor !== undefined} onClick={() => setAction('discard')}>
                  {t('ui.cb30147eec19a758')}
                </button>
              </div>
            )}
            {!portal &&
              catalog?.permissions.write &&
              !['draft', 'discarded'].includes(invoice.status) && (
                <button onClick={() => setAction('payment')}>{t('ui.1ef3fba4680a9698')}</button>
              )}
            {!portal &&
              catalog?.permissions.manage &&
              !['draft', 'discarded'].includes(invoice.status) && (
                <div className="flex gap-4">
                  <button onClick={() => setAction('refund')}>{t('ui.ebe493f66da3714a')}</button>
                  <button onClick={() => setAction('adjustment')}>
                    {t('ui.c814e045171759f1')}
                  </button>
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
