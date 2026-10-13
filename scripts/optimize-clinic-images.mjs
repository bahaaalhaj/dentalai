// Reproducible derived assets. Originals are retained, never overwritten.
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../apps/web/', import.meta.url);
const output = new URL('public/pics/', root);
await mkdir(output, { recursive: true });
const manifest = [];
for (let i = 1; i <= 8; i++) {
  const input = await readFile(new URL(`assets/clinic-originals/img${i}.jpg`, root));
  for (const width of [320, 640]) {
    const result = await sharp(input)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 78, effort: 6 })
      .toBuffer({ resolveWithObject: true });
    const name = `img${i}-${width}.webp`;
    await writeFile(new URL(name, output), result.data);
    manifest.push({
      name,
      width: result.info.width,
      height: result.info.height,
      bytes: result.data.length,
      sourceSha256: createHash('sha256').update(input).digest('hex'),
      sha256: createHash('sha256').update(result.data).digest('hex'),
    });
  }
}
await writeFile(new URL('manifest.json', output), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  JSON.stringify({ variants: manifest.length, bytes: manifest.reduce((n, a) => n + a.bytes, 0) }),
);
