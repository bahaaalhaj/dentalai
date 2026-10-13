import { InferenceSchema, MAX_INFERENCE_BYTES, type InferenceResult } from '@dentalai/contracts';
import { DomainError } from '../../errors/domain-errors.js';
import { checksum } from './image-validation.js';

export interface InferenceClient {
  infer(data: Buffer): Promise<InferenceResult>;
}
export class PrivateInferenceClient implements InferenceClient {
  async health(): Promise<void> {
    const response = await fetch(`${this.url}/ready`, {
      signal: AbortSignal.timeout(2500),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Inference is not ready');
  }
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly timeoutMs = 30000,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
      throw new Error('Inference timeout must be bounded to 30 seconds.');
  }
  async infer(data: Buffer): Promise<InferenceResult> {
    try {
      const response = await fetch(`${this.url}/v1/infer`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'image/png' },
        body: new Uint8Array(data),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
      if (!response.ok || !response.body) throw new Error('Inference unavailable');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_INFERENCE_BYTES) {
            await reader.cancel();
            throw new Error('Invalid inference response');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const result = InferenceSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (result.imageSha256 !== checksum(data)) throw new Error('Image checksum mismatch');
      return result;
    } catch {
      throw new DomainError(
        'INFERENCE_UNAVAILABLE',
        'X-ray inference is unavailable. No findings were generated.',
        503,
      );
    }
  }
}
