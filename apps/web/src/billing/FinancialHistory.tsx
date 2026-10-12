import { t } from '../i18n';
import type { BillingInvoice } from '@dentalai/contracts';
import { showMoney } from './Money';
export function FinancialHistory({ invoice }: { invoice: BillingInvoice }) {
  return (
    <details className="bg-white border rounded-xl p-4">
      <summary>{t('ui.03705f621ede067f')}</summary>
      {!invoice.events.length && <p>{t('ui.68eb7d8449080a9d')}</p>}
      {invoice.events.map((e) => (
        <article key={e.id} className="border-b py-3">
          <p>
            {e.kind.replaceAll('_', ' ')} · {showMoney(e.amountMinor, e.currency)} ·{' '}
            {new Date(e.recordedAt).toLocaleString()}
          </p>
          {e.method && (
            <p>
              {t('ui.3cca555f38a507ba')}
              {e.method.replaceAll('_', ' ')}
            </p>
          )}
          {e.reason && (
            <p>
              {t('ui.4bc4df5f6ced4467')}
              {e.reason}
            </p>
          )}
          {e.receiptReference && (
            <p className="break-all">
              {t('ui.6606ef38066d862f')}
              <strong>{e.receiptReference}</strong>
            </p>
          )}
        </article>
      ))}
    </details>
  );
}
