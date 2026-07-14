export interface FetchImageResult {
  buffer: Buffer;
  contentType: string;
}

export class ImageFetchError extends Error {
  reason: 'not_found' | 'forbidden' | 'timeout' | 'other';
  status?: number;

  constructor(message: string, reason: 'not_found' | 'forbidden' | 'timeout' | 'other', status?: number) {
    super(message);
    this.reason = reason;
    this.status = status;
  }
}

export async function fetchImage(url: string, timeoutMs = 30000): Promise<FetchImageResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Referer: 'https://www.menkind.co.uk/',
      },
    });

    if (response.status === 404) throw new ImageFetchError(`Image not found: ${url}`, 'not_found', 404);
    if (response.status === 403) throw new ImageFetchError(`Image forbidden: ${url}`, 'forbidden', 403);
    if (!response.ok) {
      throw new ImageFetchError(`Image fetch failed with status ${response.status}: ${url}`, 'other', response.status);
    }

    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType };
  } catch (err) {
    if (err instanceof ImageFetchError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ImageFetchError(`Image fetch timed out: ${url}`, 'timeout');
    }
    throw new ImageFetchError(`Image fetch error: ${(err as Error).message}`, 'other');
  } finally {
    clearTimeout(timeout);
  }
}
