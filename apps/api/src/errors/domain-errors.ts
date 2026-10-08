export interface ErrorDetail {
  path: string;
  message: string;
}

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly details?: readonly ErrorDetail[],
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class RequestValidationError extends DomainError {
  constructor(details: readonly ErrorDetail[]) {
    super('INVALID_REQUEST', 'The request is invalid.', 400, details);
    this.name = 'RequestValidationError';
  }
}

export class RouteNotFoundError extends DomainError {
  constructor() {
    super('NOT_FOUND', 'The requested resource was not found.', 404);
    this.name = 'RouteNotFoundError';
  }
}

export class DependencyUnavailableError extends DomainError {
  constructor() {
    super('SERVICE_UNAVAILABLE', 'A required service is temporarily unavailable.', 503);
    this.name = 'DependencyUnavailableError';
  }
}

export class ResponseValidationError extends Error {
  constructor(override readonly cause: unknown) {
    super('An API response failed its contract validation.');
    this.name = 'ResponseValidationError';
  }
}
