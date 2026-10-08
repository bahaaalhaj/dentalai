import { randomBytes } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Operator-only clean-clone setup. Never rewrites an existing configuration. */
export async function configureLocalDevelopment(root: string) {
  for (const file of ['.env', 'infra/.env']) {
    try {
      await access(path.join(root, file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    throw new Error(
      'Local configuration already exists. Preserve it and configure manually; nothing was overwritten.',
    );
  }
  const databasePassword = randomBytes(32).toString('base64url');
  const secret = randomBytes(48).toString('base64url');
  const local = path.join(root, '.local');
  await mkdir(local, { recursive: true, mode: 0o700 });
  await mkdir(path.join(root, 'infra'), { recursive: true });
  const directory = (name: string) => JSON.stringify(path.join(local, name).replaceAll('\\', '/'));
  await writeFile(
    path.join(root, '.env'),
    [
      '# Generated local-only configuration. Never deploy or commit this file.',
      'NODE_ENV=development',
      'HOST=localhost',
      'PORT=3000',
      'APP_ORIGIN=http://localhost:3000',
      `DATABASE_URL=postgresql://dentalai_dev:${databasePassword}@127.0.0.1:55432/dentalai_test_reset`,
      `AUTH_SECRET=${secret}`,
      'MAIL_DRIVER=filesystem',
      `PRIVATE_MAIL_DIRECTORY=${directory('mail')}`,
      'CLINICAL_STORAGE_ENABLED=true',
      'STORAGE_DRIVER=filesystem',
      `PRIVATE_STORAGE_DIRECTORY=${directory('private-objects')}`,
      'XRAY_INFERENCE_ENABLED=false',
      'VITE_ENABLE_XRAY_ANALYSIS=false',
      'VITE_ENABLE_ANESTHETIC_DECISION_SUPPORT=false',
      '',
    ].join('\n'),
    { flag: 'wx', mode: 0o600 },
  );
  await writeFile(
    path.join(root, 'infra/.env'),
    [
      'POSTGRES_DB=dentalai_test_reset',
      'POSTGRES_USER=dentalai_dev',
      `POSTGRES_PASSWORD=${databasePassword}`,
      'POSTGRES_PORT=55432',
      '',
    ].join('\n'),
    { flag: 'wx', mode: 0o600 },
  );
}
