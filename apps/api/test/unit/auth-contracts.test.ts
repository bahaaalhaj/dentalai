import { describe, expect, it } from 'vitest';
import {
  RegisterRequestSchema,
  InvitationRequestSchema,
  AuthIdentitySchema,
} from '@dentalai/contracts';

describe('safe authentication contracts', () => {
  const body = {
    name: 'Fictional',
    email: 'fictional@example.test',
    password: 'Strong-fixture-password',
  };
  it('rejects browser authority and weak passwords', () => {
    for (const extra of [
      { role: 'dentist' },
      { clinicId: 'arbitrary' },
      { userId: 'arbitrary' },
      { membership: {} },
    ])
      expect(RegisterRequestSchema.safeParse({ ...body, ...extra }).success).toBe(false);
    expect(RegisterRequestSchema.safeParse({ ...body, password: 'short' }).success).toBe(false);
  });
  it('allows only inviteable staff roles and no ownership escalation', () => {
    for (const role of ['clinic_admin', 'dentist', 'receptionist'])
      expect(InvitationRequestSchema.safeParse({ email: body.email, role }).success).toBe(true);
    expect(
      InvitationRequestSchema.safeParse({ email: body.email, role: 'clinic_owner' }).success,
    ).toBe(false);
  });
  it('has no global privileged account role', () => {
    expect(AuthIdentitySchema.shape.accountRole.parse('patient')).toBe('patient');
    expect(() => AuthIdentitySchema.shape.accountRole.parse('clinic_owner')).toThrow();
  });
});
