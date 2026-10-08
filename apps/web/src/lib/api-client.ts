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
  ClinicalWorkspaceSchema,
  ClinicalPortalSchema,
  ClinicalRecordSchema,
  ClinicalWriteSchema,
  ClinicalReviewSchema,
  EncounterSchema,
  PatientSummarySchema,
  type ClinicalWrite,
  ImagingHistorySchema,
  ImagingCapabilitiesSchema,
  ImagingImageSchema,
  ImagingRunSchema,
  ImagingReasonSchema,
  ImagingReviewSchema,
} from '@dentalai/contracts';
import { z } from 'zod';
import {
  BillingCatalogSchema,
  BillingInvoiceSchema,
  BillingMutationSchema,
  BillingLinksSchema,
  BillingReportSchema,
  InvoiceWriteSchema,
  DraftReplaceSchema,
  InvoiceActionSchema,
  PaymentWriteSchema,
  RefundWriteSchema,
  AdjustmentWriteSchema,
  ServiceWriteSchema,
  PricingWriteSchema,
} from '@dentalai/contracts';

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
  private csrfRequest: Promise<{ token: string }> | undefined;

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
  imagingHistory(patientId: string) {
    return this.get(`/api/v1/imaging/patients/${z.uuid().parse(patientId)}`, ImagingHistorySchema);
  }
  imagingCapabilities() {
    return this.get('/api/v1/imaging/capabilities', ImagingCapabilitiesSchema);
  }
  uploadClinicalImage(patientId: string, file: File, reason: string, studyId?: string) {
    const query = studyId ? `?studyId=${z.uuid().parse(studyId)}` : '';
    return this.request(
      `/api/v1/imaging/patients/${z.uuid().parse(patientId)}/images${query}`,
      ImagingImageSchema,
      'POST',
      file,
      { mime: file.type, reason: ImagingReasonSchema.parse({ reason }).reason },
    );
  }
  analyzeClinicalImage(imageId: string, reason: string) {
    return this.request(
      `/api/v1/imaging/images/${z.uuid().parse(imageId)}/analyses`,
      ImagingRunSchema,
      'POST',
      ImagingReasonSchema.parse({ reason }),
    );
  }
  reviewClinicalImage(runId: string, decision: 'confirmed' | 'rejected', reason: string) {
    return this.request(
      `/api/v1/imaging/analyses/${z.uuid().parse(runId)}/review`,
      SuccessSchema,
      'POST',
      ImagingReviewSchema.parse({ decision, reason }),
    );
  }
  billingCatalog() {
    return this.get('/api/v1/billing/catalog', BillingCatalogSchema);
  }
  billingInvoices(portal = false) {
    return this.get(
      `/api/v1/billing/${portal ? 'portal' : 'invoices'}`,
      z.array(BillingInvoiceSchema),
    );
  }
  billingLinks(patientId: string) {
    return this.get(
      `/api/v1/billing/patients/${z.uuid().parse(patientId)}/links`,
      BillingLinksSchema,
    );
  }
  billingReports() {
    return this.get('/api/v1/billing/reports', BillingReportSchema);
  }
  createInvoice(body: z.infer<typeof InvoiceWriteSchema>) {
    return this.post(
      '/api/v1/billing/invoices',
      InvoiceWriteSchema.parse(body),
      BillingMutationSchema,
    );
  }
  reviseInvoice(id: string, body: z.infer<typeof DraftReplaceSchema>) {
    return this.post(
      `/api/v1/billing/invoices/${z.uuid().parse(id)}/draft`,
      DraftReplaceSchema.parse(body),
      BillingMutationSchema,
    );
  }
  invoiceAction(
    id: string,
    action: 'issue' | 'discard',
    body: z.infer<typeof InvoiceActionSchema>,
  ) {
    return this.post(
      `/api/v1/billing/invoices/${z.uuid().parse(id)}/${action}`,
      InvoiceActionSchema.parse(body),
      BillingMutationSchema,
    );
  }
  recordPayment(id: string, body: z.infer<typeof PaymentWriteSchema>) {
    return this.post(
      `/api/v1/billing/invoices/${z.uuid().parse(id)}/payments`,
      PaymentWriteSchema.parse(body),
      BillingMutationSchema,
    );
  }
  recordRefund(id: string, body: z.infer<typeof RefundWriteSchema>) {
    return this.post(
      `/api/v1/billing/invoices/${z.uuid().parse(id)}/refunds`,
      RefundWriteSchema.parse(body),
      BillingMutationSchema,
    );
  }
  adjustInvoice(id: string, body: z.infer<typeof AdjustmentWriteSchema>) {
    return this.post(
      `/api/v1/billing/invoices/${z.uuid().parse(id)}/adjustments`,
      AdjustmentWriteSchema.parse(body),
      BillingMutationSchema,
    );
  }
  createBillingService(body: z.infer<typeof ServiceWriteSchema>) {
    return this.post(
      '/api/v1/billing/services',
      ServiceWriteSchema.parse(body),
      z.object({ success: z.literal(true) }),
    );
  }
  publishPrices(body: z.infer<typeof PricingWriteSchema>) {
    return this.post(
      '/api/v1/billing/price-lists',
      PricingWriteSchema.parse(body),
      z.object({ success: z.literal(true) }),
    );
  }
  clinicalPatients() {
    return this.get('/api/v1/clinical/patients', z.array(PatientSummarySchema));
  }
  clinicalWorkspace(id: string, encounterId?: string) {
    return this.get(
      `/api/v1/clinical/patients/${z.uuid().parse(id)}${encounterId ? `?encounterId=${z.uuid().parse(encounterId)}` : ''}`,
      ClinicalWorkspaceSchema,
    );
  }
  clinicalPortal() {
    return this.get('/api/v1/clinical/portal', ClinicalPortalSchema);
  }
  startEncounter(id: string, reason: string) {
    return this.request(
      `/api/v1/clinical/patients/${z.uuid().parse(id)}/encounters`,
      EncounterSchema,
      'POST',
      { reason, appointmentId: null },
    );
  }
  writeClinicalRecord(id: string, body: ClinicalWrite) {
    return this.request(
      `/api/v1/clinical/patients/${z.uuid().parse(id)}/records`,
      ClinicalRecordSchema,
      'POST',
      ClinicalWriteSchema.parse(body),
    );
  }
  reviewClinicalRecord(id: string, decision: 'approved' | 'rejected', reason: string) {
    return this.request(
      `/api/v1/clinical/records/${z.uuid().parse(id)}/review`,
      SuccessSchema,
      'POST',
      ClinicalReviewSchema.parse({ decision, reason }),
    );
  }
  closeEncounter(id: string, reason: string) {
    return this.request(
      `/api/v1/clinical/encounters/${z.uuid().parse(id)}/close`,
      SuccessSchema,
      'POST',
      { reason },
    );
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
  private post<T>(path: string, payload: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.request(path, schema, 'POST', payload);
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    method: string,
    payload?: unknown,
    binary?: { mime: string; reason: string },
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (method !== 'GET') {
      // Coalesce the first token fetch: concurrent GETs without a cookie would rotate each other.
      this.csrfRequest ??= this.get('/api/v1/access/csrf', z.object({ token: z.string() })).finally(
        () => {
          this.csrfRequest = undefined;
        },
      );
      const csrf = await this.csrfRequest;
      headers['x-csrf-token'] = csrf.token;
      headers['content-type'] = 'application/json';
      if (binary) {
        headers['content-type'] = binary.mime;
        headers['x-imaging-reason'] = encodeURIComponent(binary.reason);
      }
    }
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      ...(payload === undefined
        ? {}
        : { body: binary ? (payload as File) : JSON.stringify(payload) }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      if (
        response.status === 401 &&
        (path.startsWith('/api/v1/access/') ||
          path.startsWith('/api/v1/appointments') ||
          path.startsWith('/api/v1/scheduling/') ||
          path.startsWith('/api/v1/clinical/') ||
          path.startsWith('/api/v1/billing/') ||
          path.startsWith('/api/v1/imaging/')) &&
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
