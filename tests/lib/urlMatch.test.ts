import { describe, it, expect } from 'vitest';
import { normalizeUrlPath, urlPathsMatch } from '../../src/lib/urlMatch';

describe('normalizeUrlPath', () => {
  it('strips scheme and host, keeping only the path', () => {
    const url = 'http://www.menkind.co.uk/product_images/i/924/126105_100x100__64969.jpg';
    expect(normalizeUrlPath(url)).toBe('/product_images/i/924/126105_100x100__64969.jpg');
  });

  it('returns the same path regardless of scheme or host', () => {
    const a = 'http://www.menkind.co.uk/product_images/i/924/126105_100x100__64969.jpg';
    const b = 'https://store-1cfhlpd74o.mybigcommerce.com/product_images/i/924/126105_100x100__64969.jpg';
    expect(normalizeUrlPath(a)).toBe(normalizeUrlPath(b));
  });

  it('returns the raw string unchanged if it is not a valid URL', () => {
    expect(normalizeUrlPath('not-a-url')).toBe('not-a-url');
  });
});

describe('urlPathsMatch', () => {
  it('returns true for URLs sharing a path across different hosts', () => {
    const a = 'http://www.menkind.co.uk/product_images/i/924/file.jpg';
    const b = 'https://store-1cfhlpd74o.mybigcommerce.com/product_images/i/924/file.jpg';
    expect(urlPathsMatch(a, b)).toBe(true);
  });

  it('returns false for genuinely different paths', () => {
    const a = 'http://www.menkind.co.uk/product_images/i/924/file.jpg';
    const b = 'http://www.menkind.co.uk/product_images/x/000/other.jpg';
    expect(urlPathsMatch(a, b)).toBe(false);
  });
});
