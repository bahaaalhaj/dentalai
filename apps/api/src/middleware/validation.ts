import type { RequestHandler, Response } from 'express';
import { z } from 'zod';
import { RequestValidationError, ResponseValidationError } from '../errors/domain-errors.js';

export interface RequestSchemas {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
}

type ValidatedLocation = 'params' | 'query' | 'body';
type ValidatedData = Partial<Record<ValidatedLocation, unknown>>;

function formatIssues(error: z.ZodError, prefix: string) {
  return error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));
}

export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (request, response, next) => {
    const validated: ValidatedData = {};
    const issues: Array<{ path: string; message: string }> = [];

    for (const location of ['params', 'query', 'body'] as const) {
      const schema = schemas[location];
      if (!schema) continue;
      const result = schema.safeParse(request[location]);
      if (result.success) {
        validated[location] = result.data;
      } else {
        issues.push(...formatIssues(result.error, location));
      }
    }

    if (issues.length > 0) {
      next(new RequestValidationError(issues));
      return;
    }

    response.locals['validatedRequest'] = validated;
    next();
  };
}

export function getValidated<T>(response: Response, location: ValidatedLocation): T {
  const validated = response.locals['validatedRequest'] as ValidatedData | undefined;
  return validated?.[location] as T;
}

export function sendValidated<T>(
  response: Response,
  schema: z.ZodType<T>,
  body: unknown,
  statusCode = 200,
): void {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ResponseValidationError(result.error);
  }
  response.status(statusCode).json(result.data);
}
