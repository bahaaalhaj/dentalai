import { z } from 'zod';
import { IdParamsSchema, ClinicRoleSchema, MembershipSchema, SuccessSchema } from './auth.js';

export const LocaleSchema = z.enum(['en', 'ar']);
export const AdministrationExportFileContract = {
  path: '/api/v1/admin/export-files/{id}',
  params: IdParamsSchema,
} as const;
export const TimezoneSchema = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Use an IANA timezone');
export const ClinicCurrencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine((value) => Intl.supportedValuesOf('currency').includes(value));
const reason = z.string().trim().min(3).max(500);
export const ClinicConfigurationSchema = z
  .object({
    legalName: z.string().trim().min(1).max(150),
    displayName: z.string().trim().min(1).max(100),
    currency: ClinicCurrencySchema,
    timezone: TimezoneSchema,
    locale: LocaleSchema,
    contactEmail: z.email().max(254).nullable(),
    contactPhone: z.string().max(40).nullable(),
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    brandMark: z.string().trim().min(1).max(8),
  })
  .strict();
export const OnboardingSchema = ClinicConfigurationSchema.extend({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .min(3)
    .max(80),
  locationName: z.string().trim().min(1).max(100),
  authorityConfirmed: z.literal(true),
}).strict();
export const ConfigurationWriteSchema = ClinicConfigurationSchema.extend({
  version: z.int().positive(),
  reason,
}).strict();
export const ClinicConfigurationResponseSchema = ClinicConfigurationSchema.extend({
  clinicId: z.uuid(),
  version: z.int().positive(),
});
export const CapacitySchema = z.object({
  seats: z.int().positive(),
  locations: z.int().positive(),
  appointments: z.int().positive(),
  storageBytes: z.int().positive(),
});
export const PlanSchema = z.object({
  code: z.string(),
  name: z.string(),
  version: z.int().positive(),
  limits: CapacitySchema,
});
export const SubscriptionSchema = z.object({
  planCode: z.string(),
  provider: z.literal('administrative-mock'),
  state: z.enum(['trial', 'active', 'past_due', 'suspended', 'cancelled']),
  periodEnd: z.iso.datetime().nullable(),
  graceEnd: z.iso.datetime().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  requestedPlan: z.string().nullable(),
  version: z.int().positive(),
  growthAllowed: z.boolean(),
  effectiveState: z.enum(['trial', 'active', 'grace', 'read_only']),
  limits: CapacitySchema,
});
export const SubscriptionActionSchema = z
  .object({
    action: z.enum(['request_plan', 'cancel', 'resume']),
    planCode: z.enum(['starter', 'team']).optional(),
    version: z.int().positive(),
    reason,
  })
  .strict();
export const UsageSchema = z.object({
  seats: z.int().nonnegative(),
  locations: z.int().nonnegative(),
  appointments: z.int().nonnegative(),
  storageBytes: z.int().nonnegative(),
  period: z.string(),
  notifications: z.int().nonnegative(),
});
export const StaffMemberSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  status: z.enum(['invited', 'active', 'suspended', 'revoked']),
  roles: z.array(ClinicRoleSchema),
});
export const MemberChangeSchema = z
  .object({
    role: z.enum(['clinic_admin', 'dentist', 'receptionist']),
    status: z.enum(['active', 'suspended', 'revoked']),
    reason,
  })
  .strict();
export const LocationWriteSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(100),
    timezone: TimezoneSchema,
    address: z.string().max(250).nullable(),
    phone: z.string().max(40).nullable(),
    active: z.boolean(),
    reason,
  })
  .strict();
export const LocationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  timezone: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  active: z.boolean(),
});
export const AuditSummarySchema = z.array(
  z.object({
    id: z.uuid(),
    action: z.string(),
    entityType: z.string(),
    occurredAt: z.iso.datetime(),
    actorName: z.string().nullable(),
  }),
);
export const NotificationPreferenceSchema = z.object({ operationalEmail: z.boolean() }).strict();
export const NotificationHistorySchema = z.array(
  z.object({
    id: z.uuid(),
    recipient: z.string(),
    category: z.enum(['invitation', 'operational']),
    state: z.enum(['queued', 'accepted', 'failed', 'skipped']),
    attempts: z.int().nonnegative(),
    provider: z.string().nullable(),
    errorCode: z.string().nullable(),
    createdAt: z.iso.datetime(),
    acceptedAt: z.iso.datetime().nullable(),
  }),
);
export const ExportRequestSchema = z.object({ reason }).strict();
export const ExportSchema = z.object({
  id: z.uuid(),
  clinicId: z.uuid(),
  createdAt: z.iso.datetime(),
  schemaVersion: z.literal('phase13-v1'),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  counts: z.record(z.string(), z.int().nonnegative()),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(
    z.object({
      id: z.uuid(),
      sha256: z.string(),
      sizeBytes: z.int().nonnegative(),
      downloadPath: z.string(),
    }),
  ),
});
export const OffboardingSchema = z
  .object({ reason, confirmation: z.string().min(1).max(100), exportId: z.uuid() })
  .strict();
export const OffboardingStateSchema = z.object({
  requestedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  retention: z.literal('retained-no-automatic-deletion'),
});
export const AdministrationOverviewSchema = z.object({
  configuration: ClinicConfigurationResponseSchema,
  subscription: SubscriptionSchema,
  usage: UsageSchema,
  members: z.array(StaffMemberSchema),
  locations: z.array(LocationSchema),
  offboarding: OffboardingStateSchema,
});

export const administrationContracts = [
  {
    method: 'post',
    path: '/api/v1/admin/onboarding',
    body: OnboardingSchema,
    response: MembershipSchema,
    public: false,
  },
  {
    method: 'get',
    path: '/api/v1/admin/overview',
    response: AdministrationOverviewSchema,
    public: false,
  },
  { method: 'get', path: '/api/v1/admin/plans', response: z.array(PlanSchema), public: false },
  {
    method: 'put',
    path: '/api/v1/admin/configuration',
    body: ConfigurationWriteSchema,
    response: ClinicConfigurationResponseSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/admin/subscription',
    body: SubscriptionActionSchema,
    response: SubscriptionSchema,
    public: false,
  },
  {
    method: 'put',
    path: '/api/v1/admin/members/{id}',
    params: IdParamsSchema,
    body: MemberChangeSchema,
    response: SuccessSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/admin/locations',
    body: LocationWriteSchema,
    response: LocationSchema,
    public: false,
  },
  { method: 'get', path: '/api/v1/admin/audit', response: AuditSummarySchema, public: false },
  {
    method: 'get',
    path: '/api/v1/admin/notifications',
    response: NotificationHistorySchema,
    public: false,
  },
  {
    method: 'get',
    path: '/api/v1/admin/notification-preferences',
    response: NotificationPreferenceSchema,
    public: false,
  },
  {
    method: 'put',
    path: '/api/v1/admin/notification-preferences',
    body: NotificationPreferenceSchema,
    response: NotificationPreferenceSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/admin/exports',
    body: ExportRequestSchema,
    response: ExportSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/admin/offboarding/request',
    body: ExportRequestSchema,
    response: OffboardingStateSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/admin/offboarding/complete',
    body: OffboardingSchema,
    response: SuccessSchema,
    public: false,
  },
] as const;
