import {
  GetBucketAclCommand,
  GetBucketPolicyCommand,
  GetBucketPolicyStatusCommand,
  GetBucketOwnershipControlsCommand,
  GetPublicAccessBlockCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DomainError } from '../../errors/domain-errors.js';
import { assertNonPublicPolicy } from './storage-policy.js';
import { withStorageDeadline } from './storage-deadline.js';

export interface PrivateStorage {
  readonly provider?: string;
  readonly bucket: string;
  put(key: string, data: Buffer, contentType: string, signal?: AbortSignal): Promise<void>;
  get(key: string, signal?: AbortSignal): Promise<Buffer>;
  delete?(key: string, signal?: AbortSignal): Promise<void>;
}
export interface S3StorageOptions {
  endpoint: string;
  hardened: boolean;
  allowInsecureLocalDevelopment?: boolean;
  encryption?: 'AES256' | 'aws:kms' | 'local-test-none';
  kmsKeyId?: string;
  timeoutMs?: number;
}
const unsupportedLocal = (error: unknown) =>
  error instanceof Error &&
  [
    'NotImplemented',
    'XNotImplemented',
    'NotImplementedError',
    'NoSuchPublicAccessBlockConfiguration',
  ].includes(error.name);

export class S3PrivateStorage implements PrivateStorage {
  readonly provider = 's3-private';
  private readonly timeoutMs: number;
  constructor(
    private readonly client: S3Client,
    readonly bucket: string,
    private readonly options: S3StorageOptions,
  ) {
    const endpoint = new URL(options.endpoint);
    const local = !options.hardened && options.allowInsecureLocalDevelopment === true;
    if (
      endpoint.username ||
      endpoint.password ||
      (endpoint.protocol !== 'https:' &&
        !(
          local &&
          endpoint.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]', 'minio'].includes(endpoint.hostname)
        ))
    )
      throw new Error(
        'Private storage requires HTTPS; HTTP requires explicit local-development configuration.',
      );
    if (options.encryption === 'local-test-none' && !local)
      throw new Error('Unencrypted test storage is prohibited outside explicit local development.');
    if (options.encryption === 'aws:kms' && !options.kmsKeyId) throw new Error('KMS key required.');
    this.timeoutMs = options.timeoutMs ?? 15000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30000)
      throw new Error('Storage timeout must be bounded to 30 seconds.');
  }
  private bounded<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    caller?: AbortSignal,
  ): Promise<T> {
    return withStorageDeadline(this.timeoutMs, operation, caller);
  }
  async health(): Promise<void> {
    await this.assertPrivate();
  }
  async assertPrivate(caller?: AbortSignal): Promise<void> {
    await this.bounded(async (signal) => {
      const send = { abortSignal: signal };
      const acl = await this.client.send(new GetBucketAclCommand({ Bucket: this.bucket }), send);
      if (acl.Grants?.some((grant) => grant.Grantee?.Type === 'Group'))
        throw new Error('Public/shared bucket grants prohibited');
      try {
        const policy = await this.client.send(
          new GetBucketPolicyCommand({ Bucket: this.bucket }),
          send,
        );
        assertNonPublicPolicy(policy.Policy);
      } catch (error) {
        if (!(error instanceof Error && error.name === 'NoSuchBucketPolicy')) throw error;
      }
      try {
        const block = (
          await this.client.send(new GetPublicAccessBlockCommand({ Bucket: this.bucket }), send)
        ).PublicAccessBlockConfiguration;
        if (
          !block?.BlockPublicAcls ||
          !block.IgnorePublicAcls ||
          !block.BlockPublicPolicy ||
          !block.RestrictPublicBuckets
        )
          throw new Error('All public-access blocking controls are required');
        const status = await this.client.send(
          new GetBucketPolicyStatusCommand({ Bucket: this.bucket }),
          send,
        );
        if (status.PolicyStatus?.IsPublic !== false)
          throw new Error('Bucket public policy status unverifiable');
        const ownership = await this.client.send(
          new GetBucketOwnershipControlsCommand({ Bucket: this.bucket }),
          send,
        );
        if (
          !ownership.OwnershipControls?.Rules?.some(
            (rule) => rule.ObjectOwnership === 'BucketOwnerEnforced',
          )
        )
          throw new Error('BucketOwnerEnforced ownership required');
      } catch (error) {
        if (!(
          unsupportedLocal(error) &&
          !this.options.hardened &&
          this.options.allowInsecureLocalDevelopment
        ))
          throw error;
        // Explicit local MinIO only; ACL/policy checks still apply. Not production clearance.
      }
    }, caller);
  }
  async put(key: string, data: Buffer, contentType: string, caller?: AbortSignal): Promise<void> {
    await this.bounded(async (signal) => {
      await this.assertPrivate(signal);
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: data,
          ContentType: contentType,
          CacheControl: 'private, no-store',
          IfNoneMatch: '*',
          ...(this.options.encryption === 'local-test-none'
            ? {}
            : {
                ServerSideEncryption: this.options.encryption ?? 'AES256',
                ...(this.options.kmsKeyId ? { SSEKMSKeyId: this.options.kmsKeyId } : {}),
              }),
        }),
        { abortSignal: signal },
      ); // Never send an object ACL.
    }, caller);
  }
  async get(key: string, caller?: AbortSignal): Promise<Buffer> {
    return this.bounded(async (signal) => {
      await this.assertPrivate(signal);
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: signal },
      );
      if (!response.Body || !response.ContentLength || response.ContentLength > 10 * 1024 * 1024)
        throw new DomainError('STORAGE_UNAVAILABLE', 'Private image storage is unavailable.', 503);
      const body = response.Body;
      const destroy = () => {
        if ('destroy' in body && typeof body.destroy === 'function') body.destroy();
      };
      signal.addEventListener('abort', destroy, { once: true });
      try {
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of body as AsyncIterable<Uint8Array>) {
          signal.throwIfAborted();
          length += chunk.length;
          if (length > 10 * 1024 * 1024) throw new Error('Private image exceeds size limit');
          chunks.push(Buffer.from(chunk));
        }
        if (length !== response.ContentLength) throw new Error('Truncated private image');
        return Buffer.concat(chunks);
      } finally {
        destroy();
        signal.removeEventListener('abort', destroy);
      }
    }, caller);
  }
  async delete(key: string, caller?: AbortSignal): Promise<void> {
    await this.bounded(async (signal) => {
      await this.assertPrivate(signal);
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), {
        abortSignal: signal,
      });
    }, caller);
  }
}
