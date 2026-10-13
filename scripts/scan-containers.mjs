// Always scan every candidate. Findings/errors still fail the aggregate gate.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { releaseTag } from './release-config.mjs';
const directory = path.resolve('.local/security');
mkdirSync(directory, { recursive: true });
const scanner =
  'aquasec/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa';
const images = {
  app: `dentalai-app:${releaseTag()}`,
  ai: `dentalai-ai:${releaseTag()}`,
  postgres: `dentalai-postgres:${releaseTag()}`,
};
let failed = false;
for (const [name, image] of Object.entries(images)) {
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      '/var/run/docker.sock:/var/run/docker.sock',
      '-v',
      'dentalai_security_trivy_cache:/root/.cache/trivy',
      '-v',
      `${directory}:/evidence`,
      scanner,
      'image',
      '--timeout',
      '15m',
      '--scanners',
      'vuln',
      '--severity',
      'HIGH,CRITICAL',
      '--exit-code',
      '1',
      '--format',
      'json',
      '--output',
      `/evidence/${name}.json`,
      image,
    ],
    { stdio: 'inherit', timeout: 16 * 60 * 1000 },
  );
  const ok = !result.error && result.status === 0;
  console.log(
    `${name}: ${ok ? 'PASS' : 'FAIL/BLOCKED'} (exit ${result.status ?? 'no exit'}); ${image}`,
  );
  if (!ok) failed = true;
}
process.exitCode = failed ? 1 : 0;
