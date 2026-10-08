import {
  ApiErrorResponseSchema,
  LivenessResponseSchema,
  OpenApiDocumentSchema,
  ReadinessResponseSchema,
  type ApiErrorResponse,
  type LivenessResponse,
  type OpenApiDocument,
  type ReadinessResponse,
  AuthIdentitySchema,
  RegisterRequestSchema,
  LoginRequestSchema,
  SuccessSchema,
  SessionListSchema,
  InvitationRequestSchema,
  InvitationSchema,
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

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly response: ApiErrorResponse | undefined,
  ) {
    super(response?.error.message ?? `API request failed with status ${status}.`);
    this.name = 'ApiClientError';
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export class DentalAiApiClient {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof globalThis.fetch;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
    this.fetchImplementation = options.fetch ?? ((...args) => globalThis.fetch(...args));
  }

  liveness(): Promise<LivenessResponse> {
    return this.get('/api/v1/health/live', LivenessResponseSchema);
  }

  readiness(): Promise<ReadinessResponse> {
    return this.get('/api/v1/health/ready', ReadinessResponseSchema);
  }

  contract(): Promise<OpenApiDocument> {
    return this.get('/api/v1/contracts/v1?format=openapi', OpenApiDocumentSchema);
  }

  me() {
    return this.get('/api/v1/access/me', AuthIdentitySchema);
  }
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
  register(body: z.infer<typeof RegisterRequestSchema>) {
    return this.request(
      '/api/v1/auth/sign-up/email',
      SuccessSchema,
      'POST',
      RegisterRequestSchema.parse(body),
    );
  }
  login(body: z.infer<typeof LoginRequestSchema>) {
    return this.request(
      '/api/v1/auth/sign-in/email',
      SuccessSchema,
      'POST',
      LoginRequestSchema.parse(body),
    );
  }
  logout() {
    return this.request('/api/v1/auth/sign-out', SuccessSchema, 'POST', {});
  }
  sessions() {
    return this.get('/api/v1/access/sessions', SessionListSchema);
  }
  revokeSession(id: string) {
    return this.request(`/api/v1/access/sessions/${z.uuid().parse(id)}`, SuccessSchema, 'DELETE');
  }
  selectMembership(membershipId: string) {
    return this.request('/api/v1/access/select-membership', SuccessSchema, 'POST', {
      membershipId: z.uuid().parse(membershipId),
    });
  }
  invite(body: z.infer<typeof InvitationRequestSchema>) {
    return this.request(
      '/api/v1/access/invitations',
      InvitationSchema,
      'POST',
      InvitationRequestSchema.parse(body),
    );
  }
  invitations() {
    return this.get('/api/v1/access/invitations', z.array(InvitationSchema));
  }
  revokeInvitation(id: string) {
    return this.request(
      `/api/v1/access/invitations/${z.uuid().parse(id)}`,
      SuccessSchema,
      'DELETE',
    );
  }
  acceptInvitation(token: string) {
    return this.request('/api/v1/access/invitations/accept', SuccessSchema, 'POST', { token });
  }
  requestReset(email: string) {
    return this.request('/api/v1/auth/request-password-reset', SuccessSchema, 'POST', { email });
  }
  resendVerification(email: string) {
    return this.request('/api/v1/auth/send-verification-email', SuccessSchema, 'POST', { email });
  }
  resetPassword(token: string, newPassword: string) {
    return this.request('/api/v1/auth/reset-password', SuccessSchema, 'POST', {
      token,
      newPassword,
    });
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.request(path, schema, 'GET');
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    method: string,
    payload?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (method !== 'GET') {
      const csrf = await this.get('/api/v1/access/csrf', z.object({ token: z.string() }));
      headers['x-csrf-token'] = csrf.token;
      headers['content-type'] = 'application/json';
    }
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      if (
        response.status === 401 &&
        (path.startsWith('/api/v1/access/') ||
          path.startsWith('/api/v1/appointments') ||
          path.startsWith('/api/v1/scheduling/')) &&
        typeof window !== 'undefined'
      )
        window.dispatchEvent(new Event('dentalai:session-expired'));
      const parsedError = ApiErrorResponseSchema.safeParse(body);
      throw new ApiClientError(response.status, parsedError.success ? parsedError.data : undefined);
    }
    return schema.parse(body);
  }
}

export const apiClient = new DentalAiApiClient();
