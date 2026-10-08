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
      title={`${action[0]!.toUpperCase() + action.slice(1)} invoice`}
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
            if (!reason.trim()) throw new Error('A reason is required.');
            if (!['issue', 'discard'].includes(action) && minor <= 0)
              throw new Error('Enter a positive amount.');
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
            setError(err instanceof Error ? err.message : 'Financial change failed.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          {invoice.invoiceNumber} · Open balance {showMoney(invoice.balanceMinor, invoice.currency)}
        </p>
        <p>
          This action is authorized and recorded permanently. Confirm the details before applying.
        </p>
        {!['issue', 'discard'].includes(action) && (
          <fieldset disabled={busy || locked} className="space-y-3">
            <Field
              label={`Amount in ${invoice.currency}`}
              value={amount}
              required
              onChange={setAmount}
            />
            {action === 'payment' && (
              <SelectField
                label="Payment method"
                value={method}
                values={['cash', 'card', 'bank_transfer', 'insurance', 'other']}
                onChange={(v) => setMethod(v as typeof method)}
              />
            )}
            {action === 'refund' && (
              <label>
                Original payment
                <select
                  aria-label="Original payment"
                  value={paymentId}
                  className="w-full border p-3"
                  onChange={(e) => setPaymentId(e.target.value)}
                >
                  <option value="">Select payment receipt</option>
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
                label="Adjustment direction"
                value={direction}
                values={['credit', 'debit']}
                onChange={setDirection}
              />
            )}
            {action !== 'adjustment' && (
              <Field
                label="External receipt reference (optional)"
                value={reference}
                onChange={setReference}
              />
            )}
          </fieldset>
        )}
        <fieldset disabled={busy || locked}>
          <Field label="Financial change reason" value={reason} required onChange={setReason} />
        </fieldset>
        {error && (
          <p role="alert" className="text-red-700">
            {error} Retry uses the same idempotency key and original details. Check financial
            history before closing or starting a different operation.
          </p>
        )}
        <button disabled={busy} className="bg-indigo-600 text-white p-3 rounded-xl">
          {locked ? 'Retry same financial action' : 'Confirm financial action'}
        </button>
      </form>
    </ActionDialog>
  );
}
