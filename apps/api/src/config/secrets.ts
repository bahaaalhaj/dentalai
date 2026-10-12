import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';

const names = [
  'DATABASE_URL',
  'AUTH_SECRET',
  'SMTP_URL',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'AI_SERVICE_TOKEN',
  'MONITORING_TOKEN',
] as const;

/** Docker/Kubernetes/VPS secret mounts. Never include values or paths in errors. */
export function resolveSecretFiles(source: Record<string, string | undefined>) {
  const resolved = { ...source };
  for (const name of names) {
    const file = source[`${name}_FILE`];
    if (!file) continue;
    if (source[name]) throw new Error(`Configure only ${name} or ${name}_FILE, not both.`);
    try {
      const stat = lstatSync(file);
      if (!path.isAbsolute(file) || !stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
        throw new Error('Invalid secret mount');
      const value = readFileSync(file, 'utf8').trim();
      if (!value || /[\r\n\0]/.test(value)) throw new Error('Invalid secret contents');
      resolved[name] = value;
    } catch {
      throw new Error(`Cannot read a valid ${name}_FILE secret mount.`);
    }
  }
  return resolved;
}
