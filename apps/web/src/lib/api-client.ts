import { SuccessSchema } from '@dentalai/contracts';
import { z } from 'zod';
import {
  AdministrationOverviewSchema,
  PlanSchema,
  ConfigurationWriteSchema,
  ClinicConfigurationResponseSchema,
  OnboardingSchema,
  MembershipSchema,
  MemberChangeSchema,
  LocationWriteSchema,
  LocationSchema,
  SubscriptionActionSchema,
  SubscriptionSchema,
  AuditSummarySchema,
  NotificationHistorySchema,
  NotificationPreferenceSchema,
  ExportRequestSchema,
  ExportSchema,
  OffboardingSchema,
  OffboardingStateSchema,
} from '@dentalai/contracts';
import { RecordsApiClient } from './api-records.js';
// Cohesive capability; inherited guards/transport behavior are unchanged.
export class DentalAiApiClient extends RecordsApiClient {
  administration() {
    return this.get('/api/v1/admin/overview', AdministrationOverviewSchema);
  }
  plans() {
    return this.get('/api/v1/admin/plans', z.array(PlanSchema));
  }
  onboard(body: z.infer<typeof OnboardingSchema>) {
    return this.post('/api/v1/admin/onboarding', OnboardingSchema.parse(body), MembershipSchema);
  }
  configureClinic(body: z.infer<typeof ConfigurationWriteSchema>) {
    return this.request(
      '/api/v1/admin/configuration',
      ClinicConfigurationResponseSchema,
      'PUT',
      ConfigurationWriteSchema.parse(body),
    );
  }
  changeMember(id: string, body: z.infer<typeof MemberChangeSchema>) {
    return this.request(
      `/api/v1/admin/members/${z.uuid().parse(id)}`,
      SuccessSchema,
      'PUT',
      MemberChangeSchema.parse(body),
    );
  }
  saveLocation(body: z.infer<typeof LocationWriteSchema>) {
    return this.post('/api/v1/admin/locations', LocationWriteSchema.parse(body), LocationSchema);
  }
  subscriptionAction(body: z.infer<typeof SubscriptionActionSchema>) {
    return this.post(
      '/api/v1/admin/subscription',
      SubscriptionActionSchema.parse(body),
      SubscriptionSchema,
    );
  }
  administrationAudit() {
    return this.get('/api/v1/admin/audit', AuditSummarySchema);
  }
  notificationHistory() {
    return this.get('/api/v1/admin/notifications', NotificationHistorySchema);
  }
  notificationPreferences(value?: boolean) {
    return value === undefined
      ? this.get('/api/v1/admin/notification-preferences', NotificationPreferenceSchema)
      : this.request(
          '/api/v1/admin/notification-preferences',
          NotificationPreferenceSchema,
          'PUT',
          { operationalEmail: value },
        );
  }
  exportClinic(reason: string) {
    return this.post('/api/v1/admin/exports', ExportRequestSchema.parse({ reason }), ExportSchema);
  }
  requestOffboarding(reason: string) {
    return this.post(
      '/api/v1/admin/offboarding/request',
      ExportRequestSchema.parse({ reason }),
      OffboardingStateSchema,
    );
  }
  completeOffboarding(body: z.infer<typeof OffboardingSchema>) {
    return this.post(
      '/api/v1/admin/offboarding/complete',
      OffboardingSchema.parse(body),
      SuccessSchema,
    );
  }
}
export { ApiClientError } from './api-client-shared.js';
export type { ApiClientOptions } from './api-client-shared.js';
export const apiClient = new DentalAiApiClient();
