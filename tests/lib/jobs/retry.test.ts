import { describe, it, expect, vi } from 'vitest';
import { retryWithBackoff } from '../../../src/lib/jobs/retry';

describe('retryWithBackoff', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, [1]);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and returns the result once it succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, [1, 1, 1]);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after exhausting all attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(retryWithBackoff(fn, [1, 1])).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
