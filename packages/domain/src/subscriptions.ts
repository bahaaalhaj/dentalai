// Product policy only: no payments, clinical constants or clinician privileges are inferred.
export interface SubscriptionState {
  state: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  periodEnd: string | null;
  graceEnd: string | null;
  cancelAtPeriodEnd: boolean;
}
export function subscriptionAccess(subscription: SubscriptionState, now: Date) {
  const validInstant = (value: string | null) =>
    value === null ? null : new Date(value).getTime();
  const end = validInstant(subscription.periodEnd),
    grace = validInstant(subscription.graceEnd);
  if (
    !Number.isFinite(now.getTime()) ||
    (end !== null && !Number.isFinite(end)) ||
    (grace !== null && !Number.isFinite(grace))
  )
    throw new Error('Invalid subscription timestamp');
  const current = now.getTime();
  const readOnly = { growthAllowed: false, effectiveState: 'read_only' as const };
  if (subscription.cancelAtPeriodEnd && (end === null || current >= end)) return readOnly;
  if (subscription.state === 'active') {
    if (end !== null && current >= (grace ?? end)) return readOnly;
    return {
      growthAllowed: true,
      effectiveState: end !== null && current >= end ? ('grace' as const) : ('active' as const),
    };
  }
  if (subscription.state === 'trial' || subscription.state === 'past_due') {
    if (end === null || current >= (grace ?? end)) return readOnly;
    return {
      growthAllowed: true,
      effectiveState:
        current >= end || subscription.state === 'past_due'
          ? ('grace' as const)
          : ('trial' as const),
    };
  }
  return readOnly;
}
