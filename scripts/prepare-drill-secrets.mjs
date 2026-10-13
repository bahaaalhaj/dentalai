import { lstatSync, chownSync } from 'node:fs';

export const drillSecretNames = [
  'postgres_password',
  'database_url',
  'migration_database_url',
  'auth_secret',
  'smtp_url',
  'monitoring_token',
];

/** Only the disposable drill's fixed mount; never production secret discovery. */
export function setDrillSecretOwnership(directory) {
  if (directory !== '/fixture-secrets') throw new Error('Invalid drill secret mount.');
  const targets = drillSecretNames.map((name) => `${directory}/${name}`);
  // Validate every file before changing anything. Preserve owner-only permissions.
  for (const target of targets) {
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600)
      throw new Error('Drill secrets must be private regular files.');
  }
  for (const target of targets) chownSync(target, 10001, 10001);
}
