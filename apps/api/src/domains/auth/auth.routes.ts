import { accessContracts, SuccessSchema } from '@dentalai/contracts';
import { Router, type Request as ExpressRequest } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { asyncHandler } from '../../middleware/async-handler.js';
import { DomainError } from '../../errors/domain-errors.js';
import { getValidated, sendValidated, validateRequest } from '../../middleware/validation.js';
import type { AuthOptions, AuthProvider } from './auth.provider.js';
import type { AccessRepository } from '../access/access.repository.js';

function authHeaders(request: ExpressRequest): Headers {
  const headers = fromNodeHeaders(request.headers);
  // Better Auth must use Express's configured trusted-proxy boundary, never client forwarding headers.
  headers.set('x-dentalai-client-ip', request.ip ?? 'unknown');
  return headers;
}

export function createAuthRouter(
  auth: AuthProvider,
  repository: AccessRepository,
  options: AuthOptions,
): Router {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader('cache-control', 'no-store');
    next();
  });
  for (const contract of accessContracts) {
    if (
      !contract.path.startsWith('/api/v1/auth/') ||
      contract.method !== 'post' ||
      !('body' in contract)
    )
      continue;
    const path = contract.path.replace('/api/v1/auth', '');
    router.post(
      path,
      validateRequest({ body: contract.body }),
      asyncHandler(async (request, response) => {
        const body = getValidated<Record<string, unknown>>(response, 'body');
        const headers = authHeaders(request);
        headers.set('content-type', 'application/json');
        const prior = await auth.api.getSession({ headers });
        const email = typeof body['email'] === 'string' ? body['email'].trim().toLowerCase() : '';
        const loginKey = repository.loginKey(email, options.secret);
        if (path === '/sign-in/email' && (await repository.loginBlocked(loginKey))) {
          await repository.security('auth.login_blocked', false, undefined, request.requestId);
          throw new DomainError(
            'LOGIN_THROTTLED',
            'Too many sign-in attempts. Try again in 15 minutes.',
            429,
          );
        }
        const payload = {
          ...body,
          ...(path === '/sign-up/email'
            ? { callbackURL: `${options.origin}/login?verified=1` }
            : {}),
          ...(path === '/request-password-reset'
            ? { redirectTo: `${options.origin}/reset-password` }
            : {}),
          ...(path === '/send-verification-email'
            ? { callbackURL: `${options.origin}/login?verified=1` }
            : {}),
        };
        const result = await auth.handler(
          new Request(`${options.origin}/api/v1/auth${path}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          }),
        );
        if (path === '/sign-in/email') {
          await repository.loginResult(loginKey, result.ok);
          // Successful authentication never retains an incoming session identifier.
          if (result.ok && prior)
            await repository.pool.query('DELETE FROM auth_sessions WHERE id=$1 AND user_id=$2', [
              prior.session.id,
              prior.user.id,
            ]);
        }
        await repository.security(
          `auth.${path.slice(1).replaceAll('/', '.')}`,
          result.ok,
          prior?.user.id,
          request.requestId,
        );
        const cookies = result.headers.getSetCookie();
        if (cookies.length) response.setHeader('set-cookie', cookies);
        if (!result.ok) {
          if (result.status >= 500)
            throw new DomainError(
              'AUTH_UNAVAILABLE',
              'Authentication is temporarily unavailable.',
              503,
            );
          throw new DomainError(
            path === '/sign-in/email' ? 'SIGN_IN_FAILED' : 'AUTH_REQUEST_FAILED',
            path === '/sign-in/email'
              ? 'Sign-in failed. Check your credentials and verify your email.'
              : 'The authentication request could not be completed.',
            result.status,
          );
        }
        // Library DTOs can include session tokens; expose only our safe contract.
        sendValidated(response, SuccessSchema, { success: true });
      }),
    );
  }
  router.get(
    '/verify-email',
    asyncHandler(async (request, response) => {
      const token = typeof request.query['token'] === 'string' ? request.query['token'] : '';
      if (!token || token.length > 4096)
        throw new DomainError('INVALID_TOKEN', 'The verification link is invalid.', 400);
      const url = new URL(`${options.origin}/api/v1/auth/verify-email`);
      url.searchParams.set('token', token);
      url.searchParams.set('callbackURL', `${options.origin}/login?verified=1`);
      const result = await auth.handler(new Request(url, { headers: authHeaders(request) }));
      const redirect = result.headers.get('location');
      if (redirect && new URL(redirect).origin === options.origin) {
        response.redirect(redirect);
        return;
      }
      if (!result.ok)
        throw new DomainError('INVALID_TOKEN', 'The verification link is invalid or expired.', 400);
      response.redirect(`${options.origin}/login?verified=1`);
    }),
  );
  return router;
}
