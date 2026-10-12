import { z } from 'zod';

export const ClinicRoleSchema = z.enum([
  'clinic_owner',
  'clinic_admin',
  'dentist',
  'receptionist',
  'patient',
]);
export type ClinicRole = z.infer<typeof ClinicRoleSchema>;
export const RegisterRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    email: z.email().max(254),
    password: z.string().min(12).max(128),
    phone: z
      .string()
      .regex(/^\+[0-9]{6,20}$/)
      .optional(),
  })
  .strict();
export const LoginRequestSchema = z
  .object({ email: z.email().max(254), password: z.string().min(1).max(128) })
  .strict();
export const EmailRequestSchema = z.object({ email: z.email().max(254) }).strict();
export const ResetPasswordRequestSchema = z
  .object({ token: z.string().min(1).max(1024), newPassword: z.string().min(12).max(128) })
  .strict();
export const MembershipSelectionSchema = z.object({ membershipId: z.uuid() }).strict();
export const InvitationRequestSchema = z
  .object({ email: z.email().max(254), role: z.enum(['clinic_admin', 'dentist', 'receptionist']) })
  .strict();
export const InvitationAcceptSchema = z.object({ token: z.string().min(32).max(128) }).strict();
export const IdParamsSchema = z.object({ id: z.uuid() }).strict();
export const SuccessSchema = z.object({ success: z.literal(true) });
export const SessionListSchema = z.array(
  z.object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    current: z.boolean(),
  }),
);
export const InvitationSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: ClinicRoleSchema,
  status: z.string(),
  expiresAt: z.iso.datetime(),
});
export const MembershipSchema = z.object({
  id: z.uuid(),
  clinicId: z.uuid(),
  clinicName: z.string(),
  roles: z.array(ClinicRoleSchema),
  locale: z.enum(['en', 'ar']).optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  brandMark: z.string().max(8).optional(),
});
export const AuthIdentitySchema = z.object({
  user: z.object({ id: z.uuid(), name: z.string(), email: z.email(), emailVerified: z.boolean() }),
  memberships: z.array(MembershipSchema),
  activeMembership: MembershipSchema.nullable(),
  accountRole: z.literal('patient'),
});
export const PatientIdentitySchema = z.object({
  id: z.uuid(),
  clinicId: z.uuid(),
  givenName: z.string(),
  familyName: z.string(),
  medicalRecordNumber: z.string(),
});
export type AuthIdentity = z.infer<typeof AuthIdentitySchema>;

// This registry is consumed by documentation generation and route validation.
export const accessContracts = [
  {
    method: 'post',
    path: '/api/v1/auth/sign-up/email',
    body: RegisterRequestSchema,
    response: SuccessSchema,
    public: true,
  },
  {
    method: 'post',
    path: '/api/v1/auth/sign-in/email',
    body: LoginRequestSchema,
    response: SuccessSchema,
    public: true,
  },
  {
    method: 'post',
    path: '/api/v1/auth/request-password-reset',
    body: EmailRequestSchema,
    response: SuccessSchema,
    public: true,
  },
  {
    method: 'post',
    path: '/api/v1/auth/send-verification-email',
    body: EmailRequestSchema,
    response: SuccessSchema,
    public: true,
  },
  {
    method: 'post',
    path: '/api/v1/auth/reset-password',
    body: ResetPasswordRequestSchema,
    response: SuccessSchema,
    public: true,
  },
  {
    method: 'post',
    path: '/api/v1/auth/sign-out',
    body: z.object({}).strict(),
    response: SuccessSchema,
    public: false,
  },
  { method: 'get', path: '/api/v1/access/me', response: AuthIdentitySchema, public: false },
  { method: 'get', path: '/api/v1/access/sessions', response: SessionListSchema, public: false },
  {
    method: 'delete',
    path: '/api/v1/access/sessions/{id}',
    params: IdParamsSchema,
    response: SuccessSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/access/select-membership',
    body: MembershipSelectionSchema,
    response: SuccessSchema,
    public: false,
  },
  { method: 'get', path: '/api/v1/access/clinic', response: MembershipSchema, public: false },
  {
    method: 'post',
    path: '/api/v1/access/invitations',
    body: InvitationRequestSchema,
    response: InvitationSchema,
    public: false,
  },
  {
    method: 'get',
    path: '/api/v1/access/invitations',
    response: z.array(InvitationSchema),
    public: false,
  },
  {
    method: 'delete',
    path: '/api/v1/access/invitations/{id}',
    params: IdParamsSchema,
    response: SuccessSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/access/invitations/accept',
    body: InvitationAcceptSchema,
    response: SuccessSchema,
    public: false,
  },
  {
    method: 'get',
    path: '/api/v1/access/patients/{id}',
    params: IdParamsSchema,
    response: PatientIdentitySchema,
    public: false,
  },
] as const;
