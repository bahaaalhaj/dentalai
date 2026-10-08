import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { validateImage } from '../../src/domains/imaging/image-validation.js';
import { PrivateInferenceClient } from '../../src/domains/imaging/inference.js';
import { readEnvironment } from '../../src/config/environment.js';

describe('private imaging safety', () => {
  it('defaults storage and inference to disabled', () => {
    const env = readEnvironment({ DATABASE_URL: 'postgres://localhost/fictional' });
    expect(env.clinicalStorageEnabled).toBe(false);
    expect(env.xrayInferenceEnabled).toBe(false);
    expect(() =>
      readEnvironment({
        DATABASE_URL: 'postgres://localhost/fictional',
        XRAY_INFERENCE_ENABLED: 'true',
      }),
    ).toThrow();
  });
  it('rejects forged MIME, scripts, tiny images, truncated images and animated formats', async () => {
    const valid = await sharp({
      create: { width: 32, height: 32, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    for (const [data, mime] of [
      [valid, 'image/jpeg'],
      [Buffer.from('<svg onload="alert(1)"/>'), 'image/png'],
      [valid.subarray(0, 20), 'image/png'],
    ] as const)
      await expect(validateImage(data, mime)).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    const animation = Buffer.alloc(20);
    animation.writeUInt32BE(8);
    animation.write('acTL', 4, 'ascii');
    animation.writeUInt32BE(2, 8);
    await expect(
      validateImage(
        Buffer.concat([valid.subarray(0, 33), animation, valid.subarray(33)]),
        'image/png',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    const tiny = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } })
      .png()
      .toBuffer();
    await expect(validateImage(tiny, 'image/png')).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    const wide = await sharp({
      create: { width: 8193, height: 16, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(validateImage(wide, 'image/png')).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });
  it('fully decodes and removes metadata and appended payloads', async () => {
    const data = await sharp({
      create: { width: 32, height: 32, channels: 3, background: 'white' },
    })
      .withMetadata()
      .png()
      .toBuffer();
    const image = await validateImage(
      Buffer.concat([data, Buffer.from('<script>malicious</script>')]),
      'image/png',
    );
    expect(image.width).toBe(32);
    expect(image.data.includes(Buffer.from('malicious'))).toBe(false);
    expect((await sharp(image.data).metadata()).exif).toBeUndefined();
  });
  it('returns unavailable on transport failures without randomized results', async () => {
    const random = vi.spyOn(Math, 'random');
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('private path'));
    await expect(
      new PrivateInferenceClient('http://localhost:8000', 'test-token').infer(Buffer.from('image')),
    ).rejects.toMatchObject({ code: 'INFERENCE_UNAVAILABLE' });
    expect(random).not.toHaveBeenCalled();
    fetch.mockRestore();
    random.mockRestore();
  });
});
