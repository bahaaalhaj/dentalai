import {
  ApiErrorResponseSchema,
  LivenessResponseSchema,
  OpenApiDocumentSchema,
  ReadinessResponseSchema,
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
} from '@dentalai/contracts';
import { z } from 'zod';
import { ApiClientError, ApiClientOptions } from './api-client-shared.js';
// Cohesive capability; inherited guards/transport behavior are unchanged.
export class ApiTransport {
  protected readonly baseUrl: string;
  protected readonly fetchImplementation: typeof globalThis.fetch;
  protected csrfRequest: Promise<{ token: string }> | undefined;
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
  protected async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.request(path, schema, 'GET');
  }
  protected post<T>(path: string, payload: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.request(path, schema, 'POST', payload);
  }
  protected async request<T>(
    path: string,
    schema: z.ZodType<T>,
    method: string,
    payload?: unknown,
    binary?: { mime: string; reason: string },
    requestKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (method === 'POST' && path.startsWith('/api/v1/imaging/'))
      headers['idempotency-key'] = requestKey ?? crypto.randomUUID();
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
        (path.startsWith('/api/v1/admin/') ||
          path.startsWith('/api/v1/access/') ||
          path.startsWith('/api/v1/appointments') ||
          path.startsWith('/api/v1/scheduling/') ||
          path.startsWith('/api/v1/clinical/') ||
          path.startsWith('/api/v1/billing/') ||
          path.startsWith('/api/v1/imaging/') ||
          path.startsWith('/api/v1/anesthesia/')) &&
        typeof window !== 'undefined'
      )
        window.dispatchEvent(new Event('dentalai:session-expired'));
      const parsedError = ApiErrorResponseSchema.safeParse(body);
      throw new ApiClientError(response.status, parsedError.success ? parsedError.data : undefined);
    }
    return schema.parse(body);
  }
}
