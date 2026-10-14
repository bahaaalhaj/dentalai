import type { BillingInvoice, BillingReportSchema } from '@dentalai/contracts';
import type { z } from 'zod';
import { t } from '../i18n';
import { showMoney } from './Money';

export function BillingSummary({
  value,
}: {
  value: BillingInvoice | z.infer<typeof BillingReportSchema>[number];
}) {
  const rows = [
    [
      'originalTotalMinor' in value ? 'polish.original' : 'polish.issued',
      'originalTotalMinor' in value ? value.originalTotalMinor : value.issuedMinor,
    ],
    ['polish.payments', value.paymentsMinor],
    ['polish.refunds', value.refundsMinor],
    ['polish.balance', value.balanceMinor],
  ] as const;
  return (
    <dl className="ui-metrics">
      {rows.map(([key, amount]) => (
        <div className="ui-card ui-metric" key={key}>
          <dt className="ui-metric-label">{t(key)}</dt>
          <dd className="ui-money-value">
            <bdi>{showMoney(amount, value.currency)}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}
