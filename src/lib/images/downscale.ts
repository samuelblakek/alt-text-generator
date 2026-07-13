import sharp from 'sharp';

export interface DownscaledImage {
  buffer: Buffer;
  mimeType: string;
}

const MAX_DIMENSION = 1024;

export async function downscaleImage(buffer: Buffer, contentType: string): Promise<DownscaledImage> {
  const isGif = contentType.includes('gif');
  const pipeline = sharp(buffer, isGif ? { animated: false } : undefined).resize({
    width: MAX_DIMENSION,
    height: MAX_DIMENSION,
    fit: 'inside',
    withoutEnlargement: true,
  });

  if (isGif) {
    const outBuffer = await pipeline.png().toBuffer();
    return { buffer: outBuffer, mimeType: 'image/png' };
  }

  const outBuffer = await pipeline.jpeg({ quality: 85 }).toBuffer();
  return { buffer: outBuffer, mimeType: 'image/jpeg' };
}
