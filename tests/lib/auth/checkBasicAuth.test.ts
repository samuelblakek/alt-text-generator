import { describe, it, expect } from 'vitest';
import { checkBasicAuth } from '../../../src/lib/auth/checkBasicAuth';

function basicHeader(user: string, password: string): string {
  return `Basic ${btoa(`${user}:${password}`)}`;
}

describe('checkBasicAuth', () => {
  it('accepts a header with the correct username and password', () => {
    const header = basicHeader('menkind', 's3cret');
    expect(checkBasicAuth(header, 'menkind', 's3cret')).toBe(true);
  });

  it('rejects a header with the wrong password', () => {
    const header = basicHeader('menkind', 'wrong');
    expect(checkBasicAuth(header, 'menkind', 's3cret')).toBe(false);
  });

  it('rejects a header with the wrong username', () => {
    const header = basicHeader('nobody', 's3cret');
    expect(checkBasicAuth(header, 'menkind', 's3cret')).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(checkBasicAuth(null, 'menkind', 's3cret')).toBe(false);
  });

  it('rejects a header that is not Basic auth', () => {
    expect(checkBasicAuth('Bearer sometoken', 'menkind', 's3cret')).toBe(false);
  });

  it('rejects malformed base64 without throwing', () => {
    expect(checkBasicAuth('Basic not-valid-base64!!!', 'menkind', 's3cret')).toBe(false);
  });

  it('rejects a decoded value with no colon separator', () => {
    const header = `Basic ${btoa('nocolonhere')}`;
    expect(checkBasicAuth(header, 'menkind', 's3cret')).toBe(false);
  });

  it('allows a password containing a colon', () => {
    const header = basicHeader('menkind', 'pass:word:with:colons');
    expect(checkBasicAuth(header, 'menkind', 'pass:word:with:colons')).toBe(true);
  });
});
