import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveArtifactBaseline } from './resolve-artifact-baseline.mjs';

test('first branch push checks all changes since main; datasets and renamed weights remain blocked', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dentalai-artifact-gate-'));
  const script = path.resolve('scripts/check-artifacts.mjs');
  const git = (args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  try {
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Synthetic test']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    writeFileSync(path.join(directory, 'README.md'), 'Synthetic artifact test');
    git(['add', '.']);
    git(['commit', '-m', 'Synthetic baseline']);
    const baseline = git(['rev-parse', 'HEAD']);
    git(['update-ref', 'refs/remotes/origin/main', baseline]);
    git(['switch', '-c', 'phase16-fixture']);
    writeFileSync(path.join(directory, 'source.ts'), 'export const fixture=true;');
    git(['add', '.']);
    git(['commit', '-m', 'Synthetic safe branch']);
    const resolved = resolveArtifactBaseline(
      { ARTIFACT_PUSH_BEFORE_SHA: '0'.repeat(40), ARTIFACT_DEFAULT_BRANCH: 'main' },
      git,
    );
    assert.equal(resolved, baseline);
    const gate = () =>
      spawnSync(process.execPath, [script], {
        cwd: directory,
        env: { ...process.env, ARTIFACT_BASE_REF: resolved },
        encoding: 'utf8',
      }).status;
    assert.equal(gate(), 0);
    mkdirSync(path.join(directory, 'datasets'));
    writeFileSync(path.join(directory, 'datasets', 'fictional.txt'), 'Synthetic, not patient data');
    assert.equal(gate(), 1);
    rmSync(path.join(directory, 'datasets', 'fictional.txt'));
    writeFileSync(path.join(directory, 'weights.pt'), 'Not actual model content');
    assert.equal(gate(), 1);
    rmSync(path.join(directory, 'weights.pt'));
    git(['mv', 'source.ts', 'renamed.pt']);
    assert.equal(gate(), 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('coverage upload follows an executed coverage step; scanner clearance precedes compose and restore', () => {
  const quality = execFileSync('git', ['show', 'HEAD:.github/workflows/quality.yml'], {
    encoding: 'utf8',
  });
  // Tests inspect the candidate worktree, not a duplicated workflow implementation.
  const candidate = readFileSync('.github/workflows/quality.yml', 'utf8');
  assert.ok(quality.includes('Prevent new training data'));
  assert.match(candidate, /id: coverage/);
  assert.match(candidate, /steps\.coverage\.outcome == 'success'/);
  assert.match(candidate, /steps\.coverage\.outcome == 'failure'/);
  const security = readFileSync('.github/workflows/security.yml', 'utf8');
  assert.ok(security.indexOf('Scan ALL high') < security.indexOf('Validate pilot Compose'));
  assert.ok(
    security.indexOf('Validate pilot Compose') < security.indexOf('Restore encrypted synthetic'),
  );
  const baseline = execFileSync(
    'git',
    ['show', '580512676e7bbbf410c88136929306821b79105f:.github/workflows/security.yml'],
    { encoding: 'utf8' },
  );
  assert.equal(
    security.slice(0, security.indexOf('  containers:')),
    baseline.slice(0, baseline.indexOf('  containers:')),
  );
});
