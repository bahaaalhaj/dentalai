import {
  AuthIdentitySchema,
  IdParamsSchema,
  InvitationAcceptSchema,
  InvitationRequestSchema,
  InvitationSchema,
  MembershipSchema,
  MembershipSelectionSchema,
  PatientIdentitySchema,
  SessionListSchema,
  SuccessSchema,
  type ClinicRole,
} from '@dentalai/contracts';
import { Router, type Request, type Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import type { AuthProvider, AuthOptions } from '../auth/auth.provider.js';
import { DomainError } from '../../errors/domain-errors.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { getValidated, sendValidated, validateRequest } from '../../middleware/validation.js';
import { AccessRepository, type AccessContext } from './access.repository.js';

export async function authenticatedContext(
  auth: AuthProvider,
  repository: AccessRepository,
  request: Request,
): Promise<AccessContext> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session)
    throw new DomainError('SESSION_EXPIRED', 'Your session has expired. Sign in again.', 401);
  if (!session.user.emailVerified)
    throw new DomainError('EMAIL_NOT_VERIFIED', 'Verify your email to continue.', 403);
  const identity = await repository.identity(session.user.id, session.session.id);
  return {
    userId: session.user.id,
    sessionId: session.session.id,
    membership: identity.activeMembership,
    requestId: request.requestId,
  };
}

export function createAccessRouter(
  auth: AuthProvider,
  repository: AccessRepository,
  options: AuthOptions,
): Router {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader('cache-control', 'no-store');
    next();
  });
  router.use(
    asyncHandler(async (request, response, next) => {
      try {
        response.locals['access'] = await authenticatedContext(auth, repository, request);
        next();
      } catch (error) {
        await repository.security('auth.access_denied', false, undefined, request.requestId);
        throw error;
      }
    }),
  );
  const context = (response: Response) => response.locals['access'] as AccessContext;
  const clinic = async (response: Response, allowed?: readonly ClinicRole[]) => {
    const access = context(response);
    if (
      !access.membership ||
      (allowed && !access.membership.roles.some((role) => allowed.includes(role)))
    ) {
      await repository.security(
        'auth.authorization_denied',
        false,
        access.userId,
        access.requestId,
        access.membership?.clinicId,
      );
      throw new DomainError('ACCESS_DENIED', 'Clinic access denied.', 403);
    }
    return access.membership;
  };
  router.get(
    '/me',
    asyncHandler(async (_request, response) => {
      const access = context(response);
      sendValidated(
        response,
        AuthIdentitySchema,
        await repository.identity(access.userId, access.sessionId),
      );
    }),
  );
  router.get(
    '/sessions',
    asyncHandler(async (_request, response) => {
      sendValidated(response, SessionListSchema, await repository.sessions(context(response)));
    }),
  );
  router.delete(
    '/sessions/:id',
    validateRequest({ params: IdParamsSchema }),
    asyncHandler(async (_request, response) => {
      const access = context(response);
      await repository.revoke(access, getValidated<{ id: string }>(response, 'params').id);
      await repository.security(
        'auth.session_revoked',
        true,
        access.userId,
        access.requestId,
        access.membership?.clinicId,
      );
      sendValidated(response, SuccessSchema, { success: true });
    }),
  );
  router.post(
    '/select-membership',
    validateRequest({ body: MembershipSelectionSchema }),
    asyncHandler(async (_request, response) => {
      const access = context(response);
      try {
        await repository.select(
          access,
          getValidated<{ membershipId: string }>(response, 'body').membershipId,
        );
      } catch (error) {
        await repository.security(
          'auth.clinic_selection_denied',
          false,
          access.userId,
          access.requestId,
        );
        throw error;
      }
      await repository.security('auth.clinic_selected', true, access.userId, access.requestId);
      sendValidated(response, SuccessSchema, { success: true });
    }),
  );
  router.get(
    '/clinic',
    asyncHandler(async (_request, response) => {
      sendValidated(response, MembershipSchema, await clinic(response));
    }),
  );
  const administrators: readonly ClinicRole[] = ['clinic_owner', 'clinic_admin'];
  router.get(
    '/invitations',
    asyncHandler(async (_request, response) => {
      const membership = await clinic(response, administrators);
      sendValidated(
        response,
        z.array(InvitationSchema),
        await repository.invitationList(membership.clinicId),
      );
    }),
  );
  router.post(
    '/invitations',
    validateRequest({ body: InvitationRequestSchema }),
    asyncHandler(async (_request, response) => {
      await clinic(response, administrators);
      const access = context(response);
      const body = getValidated<z.infer<typeof InvitationRequestSchema>>(response, 'body');
      const invitation = await repository.invite(
        access,
        body.email,
        body.role,
        options.sendMail,
        options.origin,
      );
      await repository.security(
        'auth.invitation_created',
        true,
        access.userId,
        access.requestId,
        access.membership?.clinicId,
      );
      sendValidated(response, InvitationSchema, invitation);
    }),
  );
  router.delete(
    '/invitations/:id',
    validateRequest({ params: IdParamsSchema }),
    asyncHandler(async (_request, response) => {
      const membership = await clinic(response, administrators);
      const access = context(response);
      await repository.revokeInvitation(
        membership.clinicId,
        getValidated<{ id: string }>(response, 'params').id,
      );
      await repository.security(
        'auth.invitation_revoked',
        true,
        access.userId,
        access.requestId,
        membership.clinicId,
      );
      sendValidated(response, SuccessSchema, { success: true });
    }),
  );
  router.post(
    '/invitations/accept',
    validateRequest({ body: InvitationAcceptSchema }),
    asyncHandler(async (_request, response) => {
      const access = context(response);
      const clinicId = await repository.accept(
        access,
        getValidated<{ token: string }>(response, 'body').token,
      );
      await repository.security(
        'auth.invitation_accepted',
        true,
        access.userId,
        access.requestId,
        clinicId,
      );
      sendValidated(response, SuccessSchema, { success: true });
    }),
  );
  router.get(
    '/patients/:id',
    validateRequest({ params: IdParamsSchema }),
    asyncHandler(async (_request, response) => {
      await clinic(response);
      const access = context(response);
      try {
        sendValidated(
          response,
          PatientIdentitySchema,
          await repository.patient(access, getValidated<{ id: string }>(response, 'params').id),
        );
      } catch (error) {
        await repository.security(
          'auth.patient_access_denied',
          false,
          access.userId,
          access.requestId,
          access.membership?.clinicId,
        );
        throw error;
      }
    }),
  );
  return router;
}
