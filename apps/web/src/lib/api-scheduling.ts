import {
  SuccessSchema,
  SchedulingCatalogSchema,
  AvailabilitySchema,
  AppointmentSchema,
  AppointmentListSchema,
  AppointmentHistorySchema,
  AvailabilityQuerySchema,
  BookingSchema,
  StaffBookingSchema,
  AppointmentActionSchema,
  RescheduleSchema,
  type AppointmentListQuerySchema,
  type OperatoryInputSchema,
  type TypeInputSchema,
  type HourInputSchema,
  type ClosureInputSchema,
  type SchedulingPolicySchema,
} from '@dentalai/contracts';
import { z } from 'zod';
import { ApiTransport } from './api-transport.js';
// Cohesive capability; inherited guards/transport behavior are unchanged.
export class SchedulingApiClient extends ApiTransport {
  schedulingCatalog() {
    return this.get('/api/v1/scheduling/catalog', SchedulingCatalogSchema);
  }
  availability(query: z.infer<typeof AvailabilityQuerySchema>) {
    return this.get(
      `/api/v1/scheduling/availability?${new URLSearchParams(AvailabilityQuerySchema.parse(query))}`,
      AvailabilitySchema,
    );
  }
  appointments(query: Partial<z.infer<typeof AppointmentListQuerySchema>> = {}) {
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) values[key] = String(value);
    return this.get(`/api/v1/appointments?${new URLSearchParams(values)}`, AppointmentListSchema);
  }
  appointmentHistory(id: string) {
    return this.get(`/api/v1/appointments/${z.uuid().parse(id)}/history`, AppointmentHistorySchema);
  }
  bookAppointment(slotToken: string) {
    return this.request(
      '/api/v1/appointments',
      AppointmentSchema,
      'POST',
      BookingSchema.parse({ slotToken }),
    );
  }
  bookStaffAppointment(slotToken: string, patientId: string) {
    return this.request(
      '/api/v1/appointments/staff',
      AppointmentSchema,
      'POST',
      StaffBookingSchema.parse({ slotToken, patientId }),
    );
  }
  appointmentAction(id: string, body: z.infer<typeof AppointmentActionSchema>) {
    return this.request(
      `/api/v1/appointments/${z.uuid().parse(id)}/actions`,
      AppointmentSchema,
      'POST',
      AppointmentActionSchema.parse(body),
    );
  }
  rescheduleAppointment(id: string, slotToken: string, revision: number) {
    return this.request(
      `/api/v1/appointments/${z.uuid().parse(id)}/reschedule`,
      AppointmentSchema,
      'POST',
      RescheduleSchema.parse({ slotToken, revision }),
    );
  }
  addOperatory(body: z.infer<typeof OperatoryInputSchema>) {
    return this.request('/api/v1/scheduling/operatories', SuccessSchema, 'POST', body);
  }
  addAppointmentType(body: z.infer<typeof TypeInputSchema>) {
    return this.request('/api/v1/scheduling/types', SuccessSchema, 'POST', body);
  }
  addWorkingHours(body: z.input<typeof HourInputSchema>) {
    return this.request('/api/v1/scheduling/hours', SuccessSchema, 'POST', body);
  }
  removeWorkingHours(id: string) {
    return this.request(`/api/v1/scheduling/hours/${z.uuid().parse(id)}`, SuccessSchema, 'DELETE');
  }
  addClosure(body: z.input<typeof ClosureInputSchema>) {
    return this.request('/api/v1/scheduling/closures', SuccessSchema, 'POST', body);
  }
  removeClosure(id: string) {
    return this.request(
      `/api/v1/scheduling/closures/${z.uuid().parse(id)}`,
      SuccessSchema,
      'DELETE',
    );
  }
  setSchedulingPolicy(body: z.infer<typeof SchedulingPolicySchema>) {
    return this.request('/api/v1/scheduling/policy', SuccessSchema, 'PUT', body);
  }
}
