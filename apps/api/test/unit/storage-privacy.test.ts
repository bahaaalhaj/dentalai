import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  GetBucketAclCommand,
  GetBucketPolicyCommand,
  GetPublicAccessBlockCommand,
  GetBucketOwnershipControlsCommand,
  GetBucketPolicyStatusCommand,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { S3PrivateStorage } from '../../src/domains/imaging/storage.js';
import { readEnvironment } from '../../src/config/environment.js';

function fixture(policy?: string, publicGrant = false) {
  const client = new S3Client({ region: 'us-east-1' });
  const send = vi.spyOn(client, 'send').mockImplementation(async (command) => {
    const metadata = { $metadata: {} };
    if (command instanceof GetBucketAclCommand)
      return { ...metadata, Grants: publicGrant ? [{ Grantee: { Type: 'Group' as const } }] : [] };
    if (command instanceof GetBucketPolicyCommand)
      return { ...metadata, ...(policy ? { Policy: policy } : {}) };
    if (command instanceof GetPublicAccessBlockCommand)
      return {
        ...metadata,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      };
    if (command instanceof GetBucketPolicyStatusCommand)
      return { ...metadata, PolicyStatus: { IsPublic: false } };
    if (command instanceof GetBucketOwnershipControlsCommand)
      return {
        ...metadata,
        OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' as const }] },
      };
    if (command instanceof GetObjectCommand)
      return {
        ...metadata,
        ContentLength: 7,
        Body: Readable.from([Buffer.from('fixture')]) as GetObjectCommandOutput['Body'],
      };
    return metadata;
  });
  return {
    client,
    send,
    storage: new S3PrivateStorage(client, 'private-clinical', {
      endpoint: 'https://private.example.invalid',
      hardened: true,
    }),
  };
}
describe('private S3 ownership, policies and bounded IO', () => {
  it('aborts a stalled response body and never returns partial image bytes', async () => {
    const f = fixture(),
      normal = f.send.getMockImplementation()!;
    const body = new Readable({ read() {} });
    f.send.mockImplementation((command, ...args) =>
      command instanceof GetObjectCommand
        ? Promise.resolve({
            $metadata: {},
            ContentLength: 7,
            Body: body as GetObjectCommandOutput['Body'],
          })
        : normal(command, ...args),
    );
    const storage = new S3PrivateStorage(f.client, 'private-clinical', {
      endpoint: 'https://private.example.invalid',
      hardened: true,
      timeoutMs: 20,
    });
    await expect(storage.get('key')).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(body.destroyed).toBe(true);
    f.client.destroy();
  });
  it('aborts each object command after successful metadata checks', async () => {
    for (const target of [PutObjectCommand, GetObjectCommand, DeleteObjectCommand]) {
      const f = fixture(),
        normal = f.send.getMockImplementation()!;
      f.send.mockImplementation((command, ...args) =>
        command instanceof target ? new Promise(() => {}) : normal(command, ...args),
      );
      const storage = new S3PrivateStorage(f.client, 'private-clinical', {
        endpoint: 'https://private.example.invalid',
        hardened: true,
        timeoutMs: 20,
      });
      await expect(
        target === PutObjectCommand
          ? storage.put('key', Buffer.from('fixture'), 'image/png')
          : target === GetObjectCommand
            ? storage.get('key')
            : storage.delete('key'),
      ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
      f.client.destroy();
    }
  });
  it('accepts owner-enforced buckets, TLS/encryption deny policies; never sends object ACL', async () => {
    const f = fixture(
      JSON.stringify({
        Statement: [
          { Effect: 'Deny', Principal: '*', Condition: { Bool: { 'aws:SecureTransport': false } } },
        ],
      }),
    );
    await f.storage.put('key', Buffer.from('fixture'), 'image/png');
    const command = f.send.mock.calls
      .map(([command]) => command)
      .find((command) => command instanceof PutObjectCommand);
    expect(command?.input).not.toHaveProperty('ACL');
    expect(command?.input).toMatchObject({
      ServerSideEncryption: 'AES256',
      CacheControl: 'private, no-store',
      IfNoneMatch: '*',
    });
    expect(await f.storage.get('key')).toEqual(Buffer.from('fixture'));
    await f.storage.delete('key');
    f.client.destroy();
  });
  it('rejects public policy and bucket grants, even if the provider policy-status says private', async () => {
    for (const f of [
      fixture(JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: '*' }] })),
      fixture(undefined, true),
    ]) {
      await expect(f.storage.put('key', Buffer.from('fixture'), 'image/png')).rejects.toThrow();
      expect(f.send.mock.calls.some(([command]) => command instanceof PutObjectCommand)).toBe(
        false,
      );
      f.client.destroy();
    }
  });
  it('allows HTTP only for explicitly named local development; prohibits unencrypted production', () => {
    const f = fixture();
    expect(
      () =>
        new S3PrivateStorage(f.client, 'bucket', {
          endpoint: 'http://localhost:9000',
          hardened: true,
          allowInsecureLocalDevelopment: true,
        }),
    ).toThrow('HTTPS');
    expect(
      () =>
        new S3PrivateStorage(f.client, 'bucket', {
          endpoint: 'https://private.example.invalid',
          hardened: true,
          encryption: 'local-test-none',
        }),
    ).toThrow('prohibited');
    expect(() =>
      readEnvironment({
        DATABASE_URL: 'postgres://localhost/test',
        S3_ENDPOINT: 'http://localhost:9000',
      }),
    ).toThrow('HTTPS');
    expect(
      readEnvironment({
        DATABASE_URL: 'postgres://localhost/test',
        S3_ENDPOINT: 'http://localhost:9000',
        S3_ALLOW_INSECURE_LOCAL_DEVELOPMENT: 'true',
      }).s3AllowInsecureLocalDevelopment,
    ).toBe(true);
    f.client.destroy();
  });
  it('bounds metadata, upload, download and deletion; propagates caller abort', async () => {
    const f = fixture();
    f.send.mockImplementation(() => new Promise(() => {}));
    const storage = new S3PrivateStorage(f.client, 'bucket', {
      endpoint: 'https://private.example.invalid',
      hardened: true,
      timeoutMs: 20,
    });
    for (const operation of [
      () => storage.assertPrivate(),
      () => storage.put('key', Buffer.from('x'), 'image/png'),
      () => storage.get('key'),
      () => storage.delete('key'),
    ])
      await expect(operation()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    const signal = AbortSignal.abort();
    await expect(storage.get('key', signal)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    f.client.destroy();
  });
});
