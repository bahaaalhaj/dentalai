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
  return {
    issue: (_request, response) => {
      const nonce = randomBytes(32).toString('hex');
      const token = `${nonce}.${signature(nonce)}`;
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
      const [nonce, mac] = token?.split('.') ?? [];
      const expected = nonce ? signature(nonce) : '';
      if (
        request.header('origin') !== origin ||
        !token ||
        cookie !== token ||
        !mac ||
        !/^[a-f0-9]{64}$/.test(mac) ||
        !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
      ) {
        next(new DomainError('CSRF_REJECTED', 'Refresh the page and try again.', 403));
        return;
      }
      next();
    },
  };
}
