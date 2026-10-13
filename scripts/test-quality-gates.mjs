import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertToolchain } from './check-toolchain.mjs';
import { releaseTag } from './release-config.mjs';
import { unresolvedCard } from './check-governance.mjs';
import { resolveArtifactBaseline } from './resolve-artifact-baseline.mjs';
const manager = JSON.parse(readFileSync('package.json', 'utf8')).packageManager;
test('artifact baseline resolves zero/missing push SHA via a verified default-branch merge-base', () => {
  const commit = 'a'.repeat(40),
    base = 'b'.repeat(40),
    calls = [];
  const git = (args) => {
    calls.push(args);
    return args[0] === 'merge-base' && args[1] !== '--is-ancestor' ? base : commit;
  };
  for (const before of ['0'.repeat(40), undefined]) {
    calls.length = 0;
    assert.equal(
      resolveArtifactBaseline(
        { ARTIFACT_PUSH_BEFORE_SHA: before, ARTIFACT_DEFAULT_BRANCH: 'main' },
        git,
      ),
      base,
    );
    assert.ok(calls.some((args) => args.join(' ') === 'merge-base HEAD refs/remotes/origin/main'));
  }
  assert.equal(
    resolveArtifactBaseline(
      { ARTIFACT_PR_BASE_SHA: commit, ARTIFACT_PUSH_BEFORE_SHA: '0'.repeat(40) },
      git,
    ),
    commit,
  );
  assert.throws(() => resolveArtifactBaseline({ ARTIFACT_PUSH_BEFORE_SHA: 'bad' }, git));
  assert.throws(() => resolveArtifactBaseline({ ARTIFACT_PUSH_BEFORE_SHA: '0'.repeat(40) }, git));
  assert.throws(() =>
    resolveArtifactBaseline({ ARTIFACT_DEFAULT_BRANCH: 'main' }, () => {
      throw new Error('missing ref');
    }),
  );
});
test('governance cannot be bypassed by deleting, blanking or changing required fields to non-text', () => {
  for (const card of [
    {},
    { license: '' },
    { license: '  ' },
    { license: true },
    { license: 'UNKNOWN' },
  ])
    assert.deepEqual(unresolvedCard(card, ['license']), ['license']);
  assert.deepEqual(unresolvedCard({ license: 'Reviewed evidence reference' }, ['license']), []);
});
test('toolchain accepts the documented manager and rejects unsupported Node/npm', () => {
  assert.doesNotThrow(() => assertToolchain('22.0.0', manager.replace('@', '/') + ' node/v22.0.0'));
  assert.throws(() => assertToolchain('20.0.0', manager.replace('@', '/')), /Node.js 22/);
  for (const agent of [undefined, 'npm/10.9.4 node/v22.0.0', 'yarn/1.0.0'])
    assert.throws(() => assertToolchain('22.0.0', agent), /Use npm@/);
});
test('a single release input is validated, not silently converted into a shell command', () => {
  assert.equal(releaseTag({}), 'local-verification');
  assert.equal(releaseTag({ RELEASE_TAG: 'ci-9333ad77' }), 'ci-9333ad77');
  for (const tag of ['../other', 'tag;echo secret', '', 'a'.repeat(129)])
    assert.throws(() => releaseTag({ RELEASE_TAG: tag }));
});
