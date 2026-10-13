import { spawnSync } from 'node:child_process';
import { releaseTag } from './release-config.mjs';
const target = process.argv[2] ?? 'app';
if (!['app', 'ai'].includes(target)) throw new Error('Build target must be app or ai.');
const args =
  target === 'app'
    ? ['build', '-f', 'infra/Dockerfile', '-t', `dentalai-app:${releaseTag()}`, '.']
    : ['build', '-t', `dentalai-ai:${releaseTag()}`, 'services/ai'];
const result = spawnSync('docker', args, { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
