import { DomainError } from '../../errors/domain-errors.js';
export function withStorageDeadline<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
  caller?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs),
    signal = caller ? AbortSignal.any([timeout, caller]) : timeout;
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new DomainError('STORAGE_UNAVAILABLE', 'Private image storage is unavailable.', 503));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    void operation(signal)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
