import {
  GetBucketAclCommand,
  GetObjectAclCommand,
  GetBucketPolicyCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DomainError } from '../../errors/domain-errors.js';

export interface PrivateStorage {
  readonly provider?: string;
  readonly bucket: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}
export class S3PrivateStorage implements PrivateStorage {
  readonly provider = 's3-private';
  async health(): Promise<void> {
    await this.assertPrivate();
  }
  constructor(
    private readonly client: S3Client,
    readonly bucket: string,
  ) {}
  // No bucket policy is allowed: anonymous or broadly shared clinical buckets fail closed.
  async assertPrivate(): Promise<void> {
    const acl = await this.client.send(new GetBucketAclCommand({ Bucket: this.bucket }), {
      abortSignal: AbortSignal.timeout(15000),
    });
    if (acl.Grants?.some((grant) => grant.Grantee?.Type === 'Group'))
      throw new Error('Shared bucket ACL is prohibited');
    try {
      const policy = await this.client.send(new GetBucketPolicyCommand({ Bucket: this.bucket }), {
        abortSignal: AbortSignal.timeout(15000),
      });
      if (policy.Policy) throw new Error('Bucket policies are not allowed for clinical storage');
    } catch (error) {
      if (!(error instanceof Error && error.name === 'NoSuchBucketPolicy')) throw error;
    }
  }
  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.assertPrivate();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        ACL: 'private',
      }),
    );
  }
  async get(key: string): Promise<Buffer> {
    await this.assertPrivate();
    const acl = await this.client.send(new GetObjectAclCommand({ Bucket: this.bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(15000),
    });
    if (acl.Grants?.some((grant) => grant.Grantee?.Type === 'Group'))
      throw new Error('Public/shared clinical object ACL is prohibited');
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body || !response.ContentLength || response.ContentLength > 20 * 1024 * 1024)
      throw new DomainError('STORAGE_UNAVAILABLE', 'Private image storage is unavailable.', 503);
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      length += chunk.length;
      if (length > 20 * 1024 * 1024) throw new Error('Object exceeds configured limit');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
