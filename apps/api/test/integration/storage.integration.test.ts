import { describe, it, expect } from 'vitest';
import {
  S3Client,
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteBucketCommand,
  PutBucketPolicyCommand,
  DeleteBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { S3PrivateStorage } from '../../src/domains/imaging/storage.js';
const endpoint = process.env['TEST_S3_ENDPOINT'];
describe.skipIf(!endpoint)('RELEASE BLOCKER when skipped: real private S3 adapter', () => {
  it('round trips private bytes, denies anonymous access and refuses public policy', async () => {
    const client = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env['TEST_S3_ACCESS_KEY'] ?? '',
        secretAccessKey: process.env['TEST_S3_SECRET_KEY'] ?? '',
      },
    });
    const bucket = `fictional-test-${randomUUID()}`;
    const key = randomUUID();
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    try {
      const storage = new S3PrivateStorage(client, bucket, {
        endpoint: endpoint!,
        hardened: false,
        allowInsecureLocalDevelopment: true,
        encryption: 'local-test-none',
      });
      await storage.put(key, Buffer.from('fixture'), 'image/png');
      expect(await storage.get(key)).toEqual(Buffer.from('fixture'));
      const anonymous = await fetch(`${endpoint}/${bucket}/${key}`);
      expect(anonymous.status).toBe(403);
      await client.send(
        new PutBucketPolicyCommand({
          Bucket: bucket,
          Policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: '*',
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${bucket}/*`],
              },
            ],
          }),
        }),
      );
      await expect(storage.get(key)).rejects.toThrow();
      await expect(
        storage.put(randomUUID(), Buffer.from('blocked'), 'image/png'),
      ).rejects.toThrow();
    } finally {
      await client.send(new DeleteBucketPolicyCommand({ Bucket: bucket }));
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      await client.send(new DeleteBucketCommand({ Bucket: bucket }));
      client.destroy();
    }
  });
});
