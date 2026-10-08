import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const safeRequestId = /^[A-Za-z0-9_-]{1,128}$/;

export const requestIdMiddleware: RequestHandler = (request, response, next) => {
  const incoming = request.header('x-request-id');
  request.requestId = incoming && safeRequestId.test(incoming) ? incoming : randomUUID();
  response.setHeader('x-request-id', request.requestId);
  next();
};
