import { describe, expect, it, vi } from 'vitest';
import { subscriptionAccess } from '@dentalai/domain';
import {
  OnboardingSchema,
  MemberChangeSchema,
  SubscriptionActionSchema,
} from '@dentalai/contracts';
import { AdministrativeSubscriptionProvider } from '../../src/domains/administration/subscription.provider.js';
import {
  encryptNotification,
  decryptNotification,
  emailNotificationProvider,
} from '../../src/domains/notifications/notification.service.js';

const state = {
  state: 'trial' as const,
  periodEnd: '2030-01-15T00:00:00Z',
  graceEnd: '2030-01-22T00:00:00Z',
  cancelAtPeriodEnd: false,
};
describe('production subscription policy and safe administrative provider', () => {
  it.each([
    ['2030-01-14T23:59:59Z', 'trial', true],
    ['2030-01-15T00:00:00Z', 'grace', true],
    ['2030-01-21T23:59:59Z', 'grace', true],
    ['2030-01-22T00:00:00Z', 'read_only', false],
  ])('evaluates the exact boundary %s', (time, effectiveState, growthAllowed) => {
    expect(subscriptionAccess(state, new Date(time))).toEqual({ effectiveState, growthAllowed });
  });
  it('fails closed for cancelled/suspended, scheduled cancellation, expired active grants and invalid clocks', () => {
    const now = new Date('2030-01-16T00:00:00Z');
    for (const s of [
      { ...state, state: 'cancelled' as const },
      { ...state, state: 'suspended' as const },
      { ...state, cancelAtPeriodEnd: true },
      { ...state, state: 'active' as const, graceEnd: null },
    ])
      expect(subscriptionAccess(s, now).growthAllowed).toBe(false);
    expect(() => subscriptionAccess(state, new Date(NaN))).toThrow();
    expect(() => subscriptionAccess({ ...state, periodEnd: 'bad' }, now)).toThrow();
    expect(
      subscriptionAccess({ ...state, state: 'active', periodEnd: null, graceEnd: null }, now)
        .growthAllowed,
    ).toBe(true);
  });
  it('only grants administrative state, never reports a charge or payment', () => {
    const provider = new AdministrativeSubscriptionProvider();
    const result = provider.change(state, 'activate', new Date('2030-01-01T00:00:00Z'));
    expect(result.state).toBe('active');
    expect(result.periodEnd).toBe('2030-01-31T00:00:00.000Z');
    expect(result).not.toHaveProperty('payment');
    expect(
      SubscriptionActionSchema.safeParse({ action: 'activate', version: 1, reason: 'Fictional' })
        .success,
    ).toBe(false);
    expect(
      MemberChangeSchema.safeParse({ role: 'clinic_owner', status: 'active', reason: 'Fictional' })
        .success,
    ).toBe(false);
    expect(
      OnboardingSchema.safeParse({ clinicId: crypto.randomUUID(), role: 'clinic_admin' }).success,
    ).toBe(false);
  });
});
describe('real notification abstraction', () => {
  it('authenticates encrypted messages and never leaks clear invitation tokens', () => {
    const message = {
      to: 'fictional@example.test',
      subject: 'Invitation',
      text: 'secret-test-token',
    };
    const encrypted = encryptNotification(message, 'test-only-notification-secret');
    expect(encrypted).not.toContain(message.text);
    expect(decryptNotification(encrypted, 'test-only-notification-secret')).toEqual(message);
    expect(() => decryptNotification(encrypted, 'wrong-key')).toThrow();
    expect(() =>
      decryptNotification(encrypted.slice(0, -4) + 'AAAA', 'test-only-notification-secret'),
    ).toThrow();
  });
  it('propagates actual provider failure rather than inventing successful delivery', async () => {
    const sender = vi.fn().mockRejectedValue(new Error('provider failure'));
    await expect(
      emailNotificationProvider(sender).send(
        { to: 'fictional@example.test', subject: 'Test', text: 'Synthetic' },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow();
    expect(sender).toHaveBeenCalledOnce();
  });
});
