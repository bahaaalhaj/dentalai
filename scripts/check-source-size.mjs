import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const violations = [];
let checked = 0;
async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      if (!['dist', 'test', 'tests', 'e2e', 'test_utils', '__pycache__'].includes(entry.name))
        await visit(file);
    } else if (
      /\.(ts|tsx|py|mjs)$/.test(file) &&
      !file.endsWith('.d.ts') &&
      file !== 'apps/web/src/i18n/generated.ts'
    ) {
      const lines = (await readFile(file, 'utf8')).trimEnd().split('\n').length;
      checked++;
      if (lines > 400) violations.push(`${file}:${lines}`);
    }
  }
}
for (const root of ['apps/api/src', 'apps/web/src', 'packages', 'services/ai/app', 'scripts'])
  await visit(root);
if (violations.length)
  throw new Error(`Handwritten source limit (400) exceeded: ${violations.join(', ')}`);
console.log(
  `Source-size gate passed: ${checked} handwritten modules. Reproducible generated catalog and tests excluded by documented policy.`,
);
