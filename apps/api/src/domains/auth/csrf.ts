import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { DomainError } from '../../errors/domain-errors.js';

const cookieName = '__Host-dentalai.csrf';
export function readCookie(request: Request, name: string): string | undefined {
  return request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export function csrfProtection(
  secret: string,
  origin: string,
): { issue: RequestHandler; verify: RequestHandler } {
  const signature = (value: string) => createHmac('sha256', secret).update(value).digest('hex');
  const validToken = (token: string | undefined): token is string => {
    if (!token || !/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token)) return false;
    const [nonce, mac] = token.split('.');
    return !!nonce && !!mac && timingSafeEqual(Buffer.from(mac), Buffer.from(signature(nonce)));
  };
  return {
    issue: (request, response) => {
      const nonce = randomBytes(32).toString('hex');
      const existing = readCookie(request, cookieName);
      // Refresh the cookie lifetime without invalidating another in-flight mutation in this browser.
      const token = validToken(existing) ? existing : `${nonce}.${signature(nonce)}`;
      response.setHeader('cache-control', 'no-store');
      response.cookie(cookieName, token, {
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 3_600_000,
      });
      response.json({ token });
    },
    verify: (request, _response, next) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        next();
        return;
      }
      const token = request.header('x-csrf-token');
      const cookie = readCookie(request, cookieName);
      // Validate both fixed-length components before constant-time comparison. An empty nonce
      // otherwise creates unequal buffers and turns a rejected request into a RangeError/500.
      if (request.header('origin') !== origin || !token || cookie !== token || !validToken(token)) {
        next(new DomainError('CSRF_REJECTED', 'Refresh the page and try again.', 403));
        return;
      }
      next();
    },
  };
}
