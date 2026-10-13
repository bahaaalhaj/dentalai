import { spawnSync } from 'node:child_process';
import { releaseTag } from './release-config.mjs';
const target = process.argv[2] ?? 'app';
if (!['app', 'ai', 'postgres'].includes(target))
  throw new Error('Build target must be app, ai or postgres.');
const args =
  target === 'app'
    ? ['build', '-f', 'infra/Dockerfile', '-t', `dentalai-app:${releaseTag()}`, '.']
    : target === 'ai'
      ? ['build', '-t', `dentalai-ai:${releaseTag()}`, 'services/ai']
      : [
          'build',
          '-f',
          'infra/postgres/Dockerfile',
          '-t',
          `dentalai-postgres:${releaseTag()}`,
          '.',
        ];
const result = spawnSync('docker', args, { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
