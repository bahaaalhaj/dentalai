import { readEnvironment } from '../../config/environment.js';
import { createDatabase } from '@dentalai/database';
import { FilesystemPrivateStorage } from './filesystem-storage.js';
import { S3PrivateStorage } from './storage.js';
import { S3Client } from '@aws-sdk/client-s3';
import { reconcileImaging } from './imaging-recovery.js';
import type { Pool } from 'pg';
const [clinic, owner, reason] = process.argv.slice(2);
if (!process.env['DATABASE_URL'] && !process.env['DATABASE_URL_FILE']) {
  try {
    process.loadEnvFile();
  } catch {
    /* Configuration validation below fails closed. */
  }
}
let pool: Pool | undefined;
try {
  const env = readEnvironment();
  pool = createDatabase(env.databaseUrl).pool;
  if (!clinic || !owner || !reason || !env.clinicalStorageEnabled)
    throw new Error('Explicit clinic/owner/reason and private storage required.');
  const storage =
    env.storageDriver === 'filesystem' && env.privateStorageDirectory
      ? new FilesystemPrivateStorage(env.privateStorageDirectory)
      : env.s3Endpoint && env.s3Bucket && env.s3AccessKey && env.s3SecretKey
        ? new S3PrivateStorage(
            new S3Client({
              endpoint: env.s3Endpoint,
              region: 'us-east-1',
              forcePathStyle: true,
              credentials: { accessKeyId: env.s3AccessKey, secretAccessKey: env.s3SecretKey },
            }),
            env.s3Bucket,
            {
              endpoint: env.s3Endpoint,
              hardened: ['production', 'staging'].includes(env.deploymentEnv),
              allowInsecureLocalDevelopment: env.s3AllowInsecureLocalDevelopment,
              encryption: env.s3Encryption,
              ...(env.s3KmsKeyId ? { kmsKeyId: env.s3KmsKeyId } : {}),
            },
          )
        : undefined;
  if (!storage) throw new Error('Explicit private storage configuration required.');
  console.log(JSON.stringify(await reconcileImaging(pool, storage, clinic, owner, reason)));
} catch {
  console.error(
    'Imaging reconciliation failed; no ambiguous object was deleted. Review private audit evidence.',
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
