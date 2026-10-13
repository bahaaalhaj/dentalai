import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertToolchain } from './check-toolchain.mjs';
import { releaseTag } from './release-config.mjs';
import { unresolvedCard } from './check-governance.mjs';
const manager = JSON.parse(readFileSync('package.json', 'utf8')).packageManager;
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
