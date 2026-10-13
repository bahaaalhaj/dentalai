import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const patch = execFileSync('git', ['diff', '--no-ext-diff', 'HEAD'], {
  maxBuffer: 16 * 1024 * 1024,
});
const files = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter((f) => /\.(ts|tsx|mjs|md|json|ya?ml|sql|ps1)$/.test(f));
const input = Buffer.concat([patch, ...files.map((f) => readFileSync(f))]);
const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '-i',
    '--network',
    'none',
    'ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f',
    'stdin',
    '--redact',
  ],
  { input, stdio: ['pipe', 'inherit', 'inherit'], timeout: 120000 },
);
console.log(
  `Scanned Git worktree diff and ${files.length} untracked source/document files; ignored local secrets are not release content.`,
);
process.exitCode = result.error ? 1 : (result.status ?? 1);
