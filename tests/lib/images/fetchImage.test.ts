import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchImage } from '../../../src/lib/images/fetchImage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchImage', () => {
  it('returns the buffer and content type on success', async () => {
    const fakeBuffer = new Uint8Array([1, 2, 3]).buffer;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => fakeBuffer,
      })
    );
    const result = await fetchImage('http://example.com/a.jpg');
    expect(result.contentType).toBe('image/jpeg');
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(Array.from(result.buffer)).toEqual([1, 2, 3]);
  });

  it('throws a not_found ImageFetchError on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, headers: { get: () => null } })
    );
    await expect(fetchImage('http://example.com/missing.jpg')).rejects.toMatchObject({
      reason: 'not_found',
    });
  });

  it('throws a forbidden ImageFetchError on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, headers: { get: () => null } })
    );
    await expect(fetchImage('http://example.com/blocked.jpg')).rejects.toMatchObject({
      reason: 'forbidden',
    });
  });

  it('sends a browser-like User-Agent and Referer header, following redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    vi.stubGlobal('fetch', fetchMock);
    await fetchImage('http://example.com/a.jpg');
    const [, options] = fetchMock.mock.calls[0];
    expect(options.redirect).toBe('follow');
    expect(options.headers['User-Agent']).toContain('Mozilla');
    expect(options.headers['Referer']).toBe('https://www.menkind.co.uk/');
  });
});
