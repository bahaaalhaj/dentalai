import { type ApiErrorResponse } from '@dentalai/contracts';
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly response: ApiErrorResponse | undefined,
  ) {
    super(response?.error.message ?? `API request failed with status ${status}.`);
    this.name = 'ApiClientError';
  }
}
export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}
