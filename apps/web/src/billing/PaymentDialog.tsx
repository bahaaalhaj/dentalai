import { t } from '../i18n';
import { displayStatus } from '../i18n/display';
import { getErrorMessage, UiValidationError } from '../lib/errors';
import { useState } from 'react';
import { ActionDialog } from '@dentalai/ui';
import type { BillingInvoice } from '@dentalai/contracts';
import {
  InvoiceActionSchema,
  PaymentWriteSchema,
  RefundWriteSchema,
  AdjustmentWriteSchema,
} from '@dentalai/contracts';
import { apiClient } from '../lib/api-client';
import { Field, SelectField } from '../clinical/ClinicalFields';
import { inputMinor, showMoney } from './Money';
export type FinancialAction = 'issue' | 'discard' | 'payment' | 'refund' | 'adjustment';
export function PaymentDialog({
  invoice,
  action,
  saved,
  close,
}: {
  invoice: BillingInvoice;
  action: FinancialAction;
  saved: (receipt: string | null) => Promise<void>;
  close: () => void;
}) {
  const [amount, setAmount] = useState(''),
    [reason, setReason] = useState(''),
    [method, setMethod] = useState<'cash' | 'card' | 'bank_transfer' | 'insurance' | 'other'>(
      'cash',
    ),
    [paymentId, setPaymentId] = useState(''),
    [reference, setReference] = useState(''),
    [direction, setDirection] = useState('credit'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false),
    [requestKey] = useState(() => crypto.randomUUID());
  return (
    <ActionDialog
      title={t('ui.fe9d57dfddc5229a', { v0: displayStatus(action) })}
      busy={busy}
      onClose={close}
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            const common = { reason, requestKey },
              base = { ...common, currency: invoice.currency },
              minor = ['issue', 'discard'].includes(action)
                ? 0
                : inputMinor(amount, invoice.currency);
            if (!reason.trim()) throw new UiValidationError(t('ui.4e2224fde3819ef0'));
            if (!['issue', 'discard'].includes(action) && minor <= 0)
              throw new UiValidationError(t('ui.8164872b175e6bdb'));
            // Validate before locking retry details: invalid local input never reached the server.
            if (action === 'issue' || action === 'discard')
              InvoiceActionSchema.parse({ ...common, expectedVersion: invoice.version });
            else if (action === 'payment')
              PaymentWriteSchema.parse({
                ...base,
                amountMinor: minor,
                method,
                externalReference: reference || null,
              });
            else if (action === 'refund')
              RefundWriteSchema.parse({
                ...base,
                amountMinor: minor,
                paymentId,
                externalReference: reference || null,
              });
            else
              AdjustmentWriteSchema.parse({
                ...base,
                amountMinor: direction === 'credit' ? -minor : minor,
              });
            setBusy(true);
            setLocked(true);
            let result;
            if (action === 'issue' || action === 'discard')
              result = await apiClient.invoiceAction(invoice.id, action, {
                ...common,
                expectedVersion: invoice.version,
              });
            else if (action === 'payment')
              result = await apiClient.recordPayment(invoice.id, {
                ...base,
                amountMinor: minor,
                method,
                externalReference: reference || null,
              });
            else if (action === 'refund')
              result = await apiClient.recordRefund(invoice.id, {
                ...base,
                amountMinor: minor,
                paymentId,
                externalReference: reference || null,
              });
            else
              result = await apiClient.adjustInvoice(invoice.id, {
                ...base,
                amountMinor: direction === 'credit' ? -minor : minor,
              });
            await saved(result.receiptReference);
          } catch (err) {
            setError(getErrorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          {invoice.invoiceNumber} {t('ui.c683c803560aca31')}
          {showMoney(invoice.balanceMinor, invoice.currency)}
        </p>
        <p>{t('ui.595253566ff847ec')}</p>
        {!['issue', 'discard'].includes(action) && (
          <fieldset disabled={busy || locked} className="space-y-3">
            <Field
              label={t('ui.64ec34d5da0ddd57', { v0: invoice.currency })}
              value={amount}
              required
              onChange={setAmount}
            />
            {action === 'payment' && (
              <SelectField
                label={t('ui.b948ac04b854394f')}
                value={method}
                values={['cash', 'card', 'bank_transfer', 'insurance', 'other']}
                displayValue={displayStatus}
                onChange={(v) => setMethod(v as typeof method)}
              />
            )}
            {action === 'refund' && (
              <label>
                {t('ui.68f4d8eab3f44316')}
                <select
                  aria-label={t('ui.68f4d8eab3f44316')}
                  value={paymentId}
                  className="w-full border p-3"
                  onChange={(e) => setPaymentId(e.target.value)}
                >
                  <option value="">{t('ui.5404d6e2e64ce51f')}</option>
                  {invoice.events
                    .filter((e) => e.kind === 'payment')
                    .map((p) => (
                      <option key={p.id} value={p.paymentId!}>
                        {p.receiptReference} · {showMoney(-p.amountMinor, invoice.currency)}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {action === 'adjustment' && (
              <SelectField
                label={t('ui.b1be7c07122318e8')}
                value={direction}
                values={['credit', 'debit']}
                displayValue={displayStatus}
                onChange={setDirection}
              />
            )}
            {action !== 'adjustment' && (
              <Field label={t('ui.e34a0b16a082251d')} value={reference} onChange={setReference} />
            )}
          </fieldset>
        )}
        <fieldset disabled={busy || locked}>
          <Field label={t('ui.a4bf416a13294895')} value={reason} required onChange={setReason} />
        </fieldset>
        {error && (
          <p role="alert" className="text-red-700">
            {error} {t('ui.636e8c4be8e04c8f')}
          </p>
        )}
        <button disabled={busy} className="bg-indigo-600 text-white p-3 rounded-xl">
          {locked ? t('ui.8654fae11054f104') : t('ui.88b6bd4c04b48da7')}
        </button>
      </form>
    </ActionDialog>
  );
}
