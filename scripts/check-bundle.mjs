import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('apps/web/dist');
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await files(target)));
    else
      result.push({
        path: path.relative(root, target).replaceAll('\\', '/'),
        bytes: (await stat(target)).size,
      });
  }
  return result;
}
const assets = await files(root);
const total = assets.reduce((n, a) => n + a.bytes, 0);
console.log(
  JSON.stringify(
    {
      totalBytes: total,
      files: assets.length,
      largest: assets.sort((a, b) => b.bytes - a.bytes).slice(0, 12),
    },
    null,
    2,
  ),
);
if (process.argv.includes('--report-only')) process.exit(0);
// Measured budgets; the locally hosted Lottie WASM has its own explicit ceiling.
const violations = assets.filter(
  (a) =>
    a.bytes > (a.path.endsWith('.wasm') ? 2_000_000 : a.path.endsWith('.js') ? 750_000 : 500_000),
);
if (total > 5_000_000 || violations.length)
  throw new Error(
    `Bundle budget exceeded: total=${total}; ${violations.map((a) => a.path).join(',')}`,
  );
