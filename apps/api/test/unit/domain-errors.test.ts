import { describe, expect, it } from 'vitest';
import {
  DependencyUnavailableError,
  RequestValidationError,
  RouteNotFoundError,
} from '../../src/errors/domain-errors.js';

describe('domain errors', () => {
  it.each([
    [
      new RequestValidationError([{ path: 'body.name', message: 'Required' }]),
      400,
      'INVALID_REQUEST',
    ],
    [new RouteNotFoundError(), 404, 'NOT_FOUND'],
    [new DependencyUnavailableError(), 503, 'SERVICE_UNAVAILABLE'],
  ])('carries an explicit safe HTTP mapping', (error, statusCode, code) => {
    expect(error.statusCode).toBe(statusCode);
    expect(error.code).toBe(code);
    expect(error.message).not.toContain('stack');
  });
});
