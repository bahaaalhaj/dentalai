// Omit optional tooling peers; install only integrity-verified, lock-pinned native decoder artifacts.
import { readFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch))
  throw new Error('Pilot images support Linux x64/arm64; validate other architectures explicitly.');
const result = spawnSync(
  'npm',
  ['ci', '--omit=dev', '--omit=optional', '--ignore-scripts', '--prefer-offline', '--no-audit'],
  { stdio: 'inherit' },
);
if (result.error || result.status !== 0)
  throw new Error('Frozen runtime dependency installation failed.');
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const directory = mkdtempSync(path.join(tmpdir(), 'dentalai-native-'));
for (const name of [
  `@img/sharp-linux-${process.arch}`,
  `@img/sharp-libvips-linux-${process.arch}`,
]) {
  const entry = lock.packages[`node_modules/${name}`];
  if (!entry?.version || !entry.integrity?.startsWith('sha512-'))
    throw new Error('Required native decoder lacks reviewed integrity/version.');
  // Packing a registry artifact does not re-resolve or modify the installed dependency tree.
  const packed = JSON.parse(
    execFileSync(
      'npm',
      [
        'pack',
        `${name}@${entry.version}`,
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        directory,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    ),
  );
  const filename = packed[0]?.filename;
  if (typeof filename !== 'string' || path.basename(filename) !== filename)
    throw new Error('Invalid packed native artifact.');
  const archive = path.join(directory, filename);
  if (
    'sha512-' + createHash('sha512').update(readFileSync(archive)).digest('base64') !==
    entry.integrity
  )
    throw new Error('Native decoder checksum mismatch.');
  const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  if (
    names.some((n) => !n.startsWith('package/') || n.split('/').includes('..') || n.includes('\\'))
  )
    throw new Error('Unsafe native archive path.');
  const listing = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8' });
  if (listing.split('\n').some((n) => /^[lh]/.test(n)))
    throw new Error('Native artifact links prohibited.');
  const target = path.join('node_modules', name);
  mkdirSync(target, { recursive: true });
  execFileSync('tar', [
    '-xzf',
    archive,
    '--directory',
    target,
    '--strip-components=1',
    '--no-same-owner',
    '--no-same-permissions',
  ]);
}
for (const name of ['drizzle-kit', 'vite', 'esbuild', 'tsx', '@esbuild-kit'])
  if (existsSync(`node_modules/${name}`))
    throw new Error(`Build dependency leaked into runtime: ${name}`);
const approved = new Map();
for (const entry of Object.values(lock.packages))
  if (entry.version && entry.name) {
    (approved.get(entry.name) ?? approved.set(entry.name, new Set()).get(entry.name)).add(
      entry.version,
    );
  }
for (const [location, entry] of Object.entries(lock.packages)) {
  const marker = location.lastIndexOf('node_modules/');
  if (marker >= 0 && entry.version) {
    const name = location.slice(marker + 13);
    (approved.get(name) ?? approved.set(name, new Set()).get(name)).add(entry.version);
  }
}
function verify(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (item.isSymbolicLink() || !item.isDirectory() || item.name.startsWith('.')) continue;
    const dir = path.join(directory, item.name);
    if (item.name.startsWith('@')) {
      verify(dir);
      continue;
    }
    const file = path.join(dir, 'package.json');
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      if (!approved.get(pkg.name)?.has(pkg.version))
        throw new Error(`Unreviewed runtime version: ${pkg.name}@${pkg.version}`);
    }
    if (existsSync(path.join(dir, 'node_modules'))) verify(path.join(dir, 'node_modules'));
  }
}
verify('node_modules');
console.log(
  'Runtime toolchain absent; every installed package version comes from the reviewed lock.',
);
