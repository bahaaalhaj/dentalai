import { ApiErrorResponseSchema, type ApiErrorResponse } from '@dentalai/contracts';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { DomainError, RouteNotFoundError, type ErrorDetail } from '../errors/domain-errors.js';

interface HttpBodyError extends Error {
  status?: number;
  type?: string;
}

function isBodyError(error: unknown): error is HttpBodyError {
  return error instanceof Error && ('status' in error || 'type' in error);
}

export function notFoundHandler(): RequestHandler {
  return (_request, _response, next) => next(new RouteNotFoundError());
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request, response, _next) => {
    let statusCode = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred.';
    let details: readonly ErrorDetail[] | undefined;

    if (error instanceof DomainError) {
      statusCode = error.statusCode;
      code = error.code;
      message = error.message;
      details = error.details;
    } else if (isBodyError(error) && error.type === 'entity.too.large') {
      statusCode = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'The request body exceeds the configured limit.';
    } else if (isBodyError(error) && error.type === 'entity.parse.failed') {
      statusCode = 400;
      code = 'MALFORMED_JSON';
      message = 'The request body is not valid JSON.';
    }

    const body: ApiErrorResponse = {
      error: {
        code,
        message,
        requestId: request.requestId,
        ...(details ? { details: [...details] } : {}),
      },
    };

    logger[statusCode >= 500 ? 'error' : 'warn'](
      {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        requestId: request.requestId,
        statusCode,
        code,
      },
      'API request failed',
    );

    const safeBody = ApiErrorResponseSchema.parse(body);
    response.status(statusCode).json(safeBody);
  };
}
