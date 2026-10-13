// Phase 15: structural evidence checks, not a claim of clinical approval or external-link health.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const ids = (file) =>
  [...read(file).matchAll(/^\|\s*((?:FR|NFR)-[A-Z0-9]+-\d{3})\s*\|/gm)].map((match) => match[1]);
const requirements = ids('docs/srs.md');
const matrix = ids('docs/requirements-traceability.md');
assert.ok(requirements.length >= 40, 'The aligned baseline must retain all requirement IDs');
assert.equal(new Set(requirements).size, requirements.length, 'Duplicate SRS requirement ID');
assert.equal(new Set(matrix).size, matrix.length, 'Duplicate traceability row');
assert.deepEqual([...matrix].sort(), [...requirements].sort(), 'Traceability coverage differs');

const testRoots = {
  U: ['apps/api/test/unit', '.test.ts'],
  I: ['apps/api/test/integration', '.integration.test.ts'],
  W: ['apps/web/src/tests', '.test.tsx'],
  E: ['apps/web/e2e', '.spec.ts'],
  DB: ['packages/database/test', '.integration.test.ts'],
  PY: ['services/ai/tests', '.py'],
};
let tests = 0;
const matrixRows = read('docs/requirements-traceability.md')
  .split('\n')
  .filter((line) => /^\|\s*(?:FR|NFR)-/.test(line))
  .join('\n');
for (const [, prefix, name] of matrixRows.matchAll(/`(U|I|W|E|DB|PY)\/([\w.-]+)`/g)) {
  const [directory, extension] = testRoots[prefix];
  const filename =
    prefix === 'PY'
      ? `test_${name}${extension}`
      : name.endsWith('.ts') || name.endsWith('.tsx')
        ? name
        : `${name}${extension}`;
  assert.ok(
    existsSync(path.join(root, directory, filename)),
    `Missing cited test: ${prefix}/${name}`,
  );
  tests++;
}

const documents = ['README.md', 'infra/README.md', 'services/ai/README.md'];
function collect(directory) {
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (file.endsWith('.md')) documents.push(file);
  }
}
collect('docs');
let links = 0;
for (const document of documents) {
  for (const [, raw] of read(document).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = raw.replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    assert.ok(
      existsSync(path.resolve(root, path.dirname(document), target)),
      `Broken local documentation link: ${document} -> ${target}`,
    );
    links++;
  }
}
console.log(
  `Documentation evidence gate passed: ${requirements.length} unique requirements, ${tests} cited test references, ${links} local file links. External links/anchors and clinical validity are not certified.`,
);
