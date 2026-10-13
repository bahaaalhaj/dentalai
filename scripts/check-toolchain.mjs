import { readFileSync } from 'node:fs';
const manager = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).packageManager;
export function assertToolchain(nodeVersion, userAgent, expected = manager.replace('@', '/')) {
  if (Number(nodeVersion.split('.')[0]) < 22)
    throw new Error('DentalAI requires Node.js 22 or newer.');
  if (!userAgent?.split(' ').includes(expected))
    throw new Error(
      `Use ${manager}. npm 10 is known to produce incompatible nested esbuild binaries; arbitrary package-manager versions are not validated.`,
    );
}
if (process.env.npm_lifecycle_event === 'preinstall') {
  assertToolchain(
    process.versions.node,
    process.env.npm_config_user_agent,
    manager.replace('@', '/'),
  );
}
