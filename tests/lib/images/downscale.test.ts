import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { downscaleImage } from '../../../src/lib/images/downscale';

async function makeTestJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .jpeg()
    .toBuffer();
}

describe('downscaleImage', () => {
  it('downscales a large jpeg to fit within 1024px', async () => {
    const input = await makeTestJpeg(2000, 1000);
    const result = await downscaleImage(input, 'image/jpeg');
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBeLessThanOrEqual(1024);
    expect(meta.height).toBeLessThanOrEqual(1024);
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('does not enlarge a small image', async () => {
    const input = await makeTestJpeg(200, 100);
    const result = await downscaleImage(input, 'image/jpeg');
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(100);
  });

  it('converts a gif content type to a static png', async () => {
    const input = await makeTestJpeg(300, 300);
    const result = await downscaleImage(input, 'image/gif');
    expect(result.mimeType).toBe('image/png');
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe('png');
  });
});
