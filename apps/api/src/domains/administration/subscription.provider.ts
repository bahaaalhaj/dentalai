import type { z } from 'zod';
import type { SubscriptionSchema } from '@dentalai/contracts';
import { DomainError } from '../../errors/domain-errors.js';
export type Subscription = z.infer<typeof SubscriptionSchema>;
export interface SubscriptionBillingProvider {
  readonly name: 'administrative-mock';
  change(
    current: Pick<Subscription, 'periodEnd' | 'graceEnd'>,
    action: 'activate' | 'past_due' | 'suspend' | 'cancel',
    now: Date,
  ): Pick<Subscription, 'state' | 'periodEnd' | 'graceEnd' | 'cancelAtPeriodEnd'>;
}
/** Operator-only grant simulator; never charges, creates receipts, or reports successful payment. */
export class AdministrativeSubscriptionProvider implements SubscriptionBillingProvider {
  readonly name = 'administrative-mock' as const;
  change(
    current: Pick<Subscription, 'periodEnd' | 'graceEnd'>,
    action: 'activate' | 'past_due' | 'suspend' | 'cancel',
    now: Date,
  ) {
    if (!Number.isFinite(now.getTime()))
      throw new DomainError('INVALID_SUBSCRIPTION', 'Invalid subscription time.', 422);
    if (action === 'activate')
      return {
        state: 'active' as const,
        periodEnd: new Date(now.getTime() + 30 * 86400000).toISOString(),
        graceEnd: null,
        cancelAtPeriodEnd: false,
      };
    if (action === 'past_due')
      return {
        state: 'past_due' as const,
        periodEnd: now.toISOString(),
        graceEnd: new Date(now.getTime() + 7 * 86400000).toISOString(),
        cancelAtPeriodEnd: false,
      };
    return {
      state: action === 'suspend' ? ('suspended' as const) : ('cancelled' as const),
      periodEnd: current.periodEnd,
      graceEnd: current.graceEnd,
      cancelAtPeriodEnd: false,
    };
  }
}
