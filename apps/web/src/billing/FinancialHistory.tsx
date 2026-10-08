import type { BillingInvoice } from '@dentalai/contracts';
import { showMoney } from './Money';
export function FinancialHistory({ invoice }: { invoice: BillingInvoice }) {
  return (
    <details className="bg-white border rounded-xl p-4">
      <summary>Financial history and receipts</summary>
      {!invoice.events.length && <p>No financial events.</p>}
      {invoice.events.map((e) => (
        <article key={e.id} className="border-b py-3">
          <p>
            {e.kind.replaceAll('_', ' ')} · {showMoney(e.amountMinor, e.currency)} ·{' '}
            {new Date(e.recordedAt).toLocaleString()}
          </p>
          {e.method && <p>Method: {e.method.replaceAll('_', ' ')}</p>}
          {e.reason && <p>Reason: {e.reason}</p>}
          {e.receiptReference && (
            <p className="break-all">
              Receipt reference: <strong>{e.receiptReference}</strong>
            </p>
          )}
        </article>
      ))}
    </details>
  );
}
