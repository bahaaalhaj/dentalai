import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureLocalDevelopment } from './configure.js';

await configureLocalDevelopment(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../'),
);
console.log(
  'Private local configuration created. Start infra:up:local, then dev:seed. No secrets are printed.',
);
