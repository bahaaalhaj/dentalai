import { t } from '../i18n';
import { formatInstant, displayStatus } from '../i18n/display';
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
            {displayStatus(e.kind)} · {showMoney(e.amountMinor, e.currency)} ·{' '}
            {formatInstant(e.recordedAt)}
          </p>
          {e.method && (
            <p>
              {t('ui.3cca555f38a507ba')}
              {displayStatus(e.method)}
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
