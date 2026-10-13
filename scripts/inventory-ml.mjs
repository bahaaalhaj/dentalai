// Counts/hashes only: never print annotations, EXIF values, filenames or image contents.
import { execFileSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
const tracked = execFileSync('git', ['ls-files', '-z'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
})
  .split('\0')
  .filter(Boolean);
const lfs = execFileSync('git', ['lfs', 'ls-files', '-n'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
})
  .trim()
  .split('\n')
  .filter(Boolean);
const groups = {},
  hashes = new Map();
let metadataContainers = 0,
  identifierPatternFiles = 0,
  unreadable = 0;
for (const file of tracked.filter(
  (f) =>
    /(^|\/)(dataset_yolo|runs|dental_training|dataset)\//.test(f) ||
    /\.(pt|pth|ckpt|onnx|weights|tflite|h5)$/i.test(f),
)) {
  const group = file.startsWith('dataset_yolo/')
    ? 'dataset'
    : /(^|\/)(runs|dental_training)\//.test(file)
      ? 'training-runs'
      : 'other-ml';
  const item = (groups[group] ??= { files: 0, bytes: 0, pointers: 0, formats: {} });
  try {
    const data = await readFile(file);
    item.files++;
    item.bytes += (await stat(file)).size;
    const format = path.extname(file).toLowerCase() || '(none)';
    item.formats[format] = (item.formats[format] ?? 0) + 1;
    if (data.subarray(0, 128).toString().startsWith('version https://git-lfs.github.com/spec/v1'))
      item.pointers++;
    else {
      const hash = createHash('sha256').update(data).digest('hex');
      hashes.set(hash, (hashes.get(hash) ?? 0) + 1);
      if (/\.(jpe?g|png|webp|tiff?)$/i.test(file)) {
        const meta = await sharp(data)
          .metadata()
          .catch(() => undefined);
        if (meta?.exif || meta?.xmp || meta?.iptc) metadataContainers++;
      } else if (
        /\.(txt|json|yaml|yml|csv)$/i.test(file) &&
        /patient[ _-]?(?:id|name)|date[ _-]?of[ _-]?birth|\bemail\b|\bMRN\b/i.test(
          data.toString('utf8'),
        )
      )
        identifierPatternFiles++;
    }
  } catch {
    unreadable++;
  }
}
const report = {
  reviewedHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  groups,
  lfsTrackedEntries: lfs.length,
  duplicateContentGroups: [...hashes.values()].filter((n) => n > 1).length,
  duplicateCopies: [...hashes.values()].reduce((n, count) => n + Math.max(0, count - 1), 0),
  metadataContainers,
  identifierPatternFiles,
  unreadable,
  limitations:
    'Heuristic metadata/pattern counts are NOT de-identification, consent, licensing, or pixel-text review evidence. LFS pointers are not inspected image bytes.',
};
await writeFile('docs/ml-inventory.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
