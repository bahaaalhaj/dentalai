import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { DomainError } from '../../errors/domain-errors.js';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const checksum = (data: Buffer) => createHash('sha256').update(data).digest('hex');
export async function validateImage(data: Buffer, mime: string) {
  const bad = () =>
    new DomainError(
      'INVALID_IMAGE',
      'Use a valid, single-frame PNG or JPEG (16–8192 pixels, maximum 10 MiB).',
      422,
    );
  if (!Buffer.isBuffer(data) || data.length === 0 || data.length > MAX_IMAGE_BYTES) throw bad();
  const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (!((png && mime === 'image/png') || (jpeg && mime === 'image/jpeg'))) throw bad();
  if (png) {
    // libvips may decode only the first APNG frame: reject animation chunks explicitly.
    let offset = 8;
    let ended = false;
    while (offset + 12 <= data.length) {
      const length = data.readUInt32BE(offset);
      if (length > data.length - offset - 12) throw bad();
      const type = data.toString('ascii', offset + 4, offset + 8);
      if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw bad();
      offset += 12 + length;
      if (type === 'IEND') {
        ended = true;
        break;
      }
    }
    if (!ended) throw bad();
  }
  try {
    const decoder = sharp(data, {
      limitInputPixels: 32 * 1024 * 1024,
      failOn: 'warning',
      animated: true,
    });
    const metadata = await decoder.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width < 16 ||
      metadata.height < 16 ||
      metadata.width > 8192 ||
      metadata.height > 8192 ||
      (metadata.pages ?? 1) !== 1 ||
      !['png', 'jpeg'].includes(metadata.format ?? '')
    )
      throw bad();
    // Re-encode after a full decode: discard EXIF, filenames, appended payloads and ancillary metadata.
    const output = await decoder.rotate().png().toBuffer({ resolveWithObject: true });
    if (output.data.length > MAX_IMAGE_BYTES) throw bad();
    return {
      data: output.data,
      width: output.info.width,
      height: output.info.height,
      contentType: 'image/png' as const,
      sha256: checksum(output.data),
      sourceSha256: checksum(data),
    };
  } catch {
    throw bad();
  }
}
