import { z } from 'zod';
import { IdParamsSchema, SuccessSchema } from './auth.js';

export const AppointmentStatusSchema = z.enum([
  'scheduled',
  'confirmed',
  'checked_in',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
]);
export const AvailabilityQuerySchema = z
  .object({ locationId: z.uuid(), appointmentTypeId: z.uuid(), date: z.iso.date() })
  .strict();
export const SlotSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  timezone: z.string(),
});
export const AvailabilitySchema = z.object({
  slots: z.array(SlotSchema),
  expiresAt: z.iso.datetime(),
  timezone: z.string(),
});
export const BookingSchema = z.object({ slotToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const StaffBookingSchema = BookingSchema.extend({ patientId: z.uuid() }).strict();
export const RescheduleSchema = BookingSchema.extend({
  revision: z.number().int().nonnegative(),
}).strict();
export const AppointmentActionSchema = z
  .object({
    action: z.enum(['confirm', 'cancel', 'no_show', 'complete', 'check_in', 'start']),
    revision: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export const AppointmentSchema = z.object({
  id: z.uuid(),
  appointmentTypeId: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  timezone: z.string(),
  status: AppointmentStatusSchema,
  revision: z.number().int().nonnegative(),
  locationName: z.string(),
  providerName: z.string().nullable(),
  operatoryName: z.string().nullable(),
  typeName: z.string(),
  patientId: z.uuid().optional(),
  patientName: z.string().optional(),
});
export const AppointmentListQuerySchema = z
  .object({
    view: z.enum(['upcoming', 'history']).default('upcoming'),
    date: z.iso.date().optional(),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const AppointmentListSchema = z.object({
  items: z.array(AppointmentSchema),
  nextOffset: z.number().int().nullable(),
});
export const AppointmentHistorySchema = z.array(
  z.object({
    action: z.string(),
    occurredAt: z.iso.datetime(),
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()),
  }),
);
const NameSchema = z.string().trim().min(1).max(150);
export const OperatoryInputSchema = z.object({ locationId: z.uuid(), name: NameSchema }).strict();
export const TypeInputSchema = z
  .object({
    name: NameSchema,
    code: z.string().regex(/^[a-z0-9_-]{1,50}$/),
    durationMinutes: z.number().int().min(5).max(480),
  })
  .strict();
export const HourInputSchema = z
  .object({
    locationId: z.uuid(),
    providerId: z.uuid().nullable().default(null),
    weekday: z.number().int().min(0).max(6),
    opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .strict()
  .refine((value) => value.opensAt < value.closesAt, {
    message: 'Hours must open before closing on the same local day.',
  });
export const ClosureInputSchema = z
  .object({
    locationId: z.uuid().nullable().default(null),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine((value) => Date.parse(value.startsAt) < Date.parse(value.endsAt), {
    message: 'Closure must end after it starts.',
  });
export const SchedulingPolicySchema = z
  .object({
    leadMinutes: z.number().int().min(0).max(10080),
    horizonDays: z.number().int().min(1).max(3650),
  })
  .strict();
export const SchedulingCatalogSchema = z.object({
  clinicTimezone: z.string(),
  locations: z.array(z.object({ id: z.uuid(), name: z.string(), timezone: z.string() })),
  types: z.array(z.object({ id: z.uuid(), name: z.string(), durationMinutes: z.number().int() })),
  providers: z.array(z.object({ id: z.uuid(), name: z.string() })),
  operatories: z.array(z.object({ id: z.uuid(), locationId: z.uuid(), name: z.string() })),
  hours: z.array(
    z.object({
      id: z.uuid(),
      locationId: z.uuid(),
      providerId: z.uuid().nullable(),
      weekday: z.number().int(),
      opensAt: z.string(),
      closesAt: z.string(),
    }),
  ),
  closures: z.array(
    z.object({
      id: z.uuid(),
      locationId: z.uuid().nullable(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      reason: z.string(),
    }),
  ),
  policy: SchedulingPolicySchema,
});
export type Appointment = z.infer<typeof AppointmentSchema>;
export type SchedulingCatalog = z.infer<typeof SchedulingCatalogSchema>;
export const appointmentContracts = [
  {
    method: 'get',
    path: '/api/v1/scheduling/catalog',
    response: SchedulingCatalogSchema,
    public: false,
  },
  {
    method: 'get',
    path: '/api/v1/scheduling/availability',
    query: AvailabilityQuerySchema,
    response: AvailabilitySchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/appointments',
    body: BookingSchema,
    response: AppointmentSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/appointments/staff',
    body: StaffBookingSchema,
    response: AppointmentSchema,
    public: false,
  },
  {
    method: 'get',
    path: '/api/v1/appointments',
    query: AppointmentListQuerySchema,
    response: AppointmentListSchema,
    public: false,
  },
  {
    method: 'get',
    path: '/api/v1/appointments/{id}',
    params: IdParamsSchema,
    response: AppointmentSchema,
    public: false,
  },
  {
    method: 'get',
    path: '/api/v1/appointments/{id}/history',
    params: IdParamsSchema,
    response: AppointmentHistorySchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/appointments/{id}/actions',
    params: IdParamsSchema,
    body: AppointmentActionSchema,
    response: AppointmentSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/appointments/{id}/reschedule',
    params: IdParamsSchema,
    body: RescheduleSchema,
    response: AppointmentSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/scheduling/operatories',
    body: OperatoryInputSchema,
    response: SuccessSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/scheduling/types',
    body: TypeInputSchema,
    response: SuccessSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/scheduling/hours',
    body: HourInputSchema,
    response: SuccessSchema,
    public: false,
  },
  {
    method: 'delete',
    path: '/api/v1/scheduling/hours/{id}',
    params: IdParamsSchema,
    response: SuccessSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/scheduling/closures',
    body: ClosureInputSchema,
    response: SuccessSchema,
    public: false,
  },
  {
    method: 'delete',
    path: '/api/v1/scheduling/closures/{id}',
    params: IdParamsSchema,
    response: SuccessSchema,
    public: false,
  },
  {
    method: 'put',
    path: '/api/v1/scheduling/policy',
    body: SchedulingPolicySchema,
    response: SuccessSchema,
    public: false,
  },
] as const;
