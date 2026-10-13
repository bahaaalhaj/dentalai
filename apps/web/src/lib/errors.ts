import { t } from '../i18n';
import { ApiClientError } from './api-client-shared';
export class UiValidationError extends Error {}
export function getErrorMessage(error: unknown, fallback = t('error.generic')): string {
  if (error instanceof UiValidationError) return error.message;
  if (!(error instanceof ApiClientError)) return fallback;
  switch (error.status) {
    case 401:
      return t('error.session');
    case 403:
      return t('error.forbidden');
    case 404:
      return t('error.notFound');
    case 409:
      return t('error.conflict');
    case 400:
    case 415:
    case 422:
      return t('error.invalid');
    case 413:
      return t('error.large');
    case 429:
      return t('error.rate');
    case 503:
      return t('error.unavailable');
    default:
      return fallback;
  }
}
