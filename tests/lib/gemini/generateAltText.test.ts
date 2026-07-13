import { describe, it, expect, vi } from 'vitest';
import { generateAltText } from '../../../src/lib/gemini/generateAltText';
import type { GoogleGenerativeAI } from '@google/generative-ai';

describe('generateAltText', () => {
  it('sends the image and product name and returns trimmed text', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      response: { text: () => '  A red widget on a white background  ' },
    });
    const getGenerativeModel = vi.fn().mockReturnValue({ generateContent });
    const fakeClient = { getGenerativeModel } as unknown as GoogleGenerativeAI;

    const result = await generateAltText(fakeClient, {
      imageBuffer: Buffer.from([1, 2, 3]),
      mimeType: 'image/jpeg',
      productName: 'Red Widget',
    });

    expect(result).toBe('A red widget on a white background');
    expect(getGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.0-flash' })
    );
    const [parts] = generateContent.mock.calls[0];
    expect(parts[0].inlineData.mimeType).toBe('image/jpeg');
    expect(parts[1].text).toContain('Red Widget');
  });

  it('includes the reviewer hint in the prompt when provided', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      response: { text: () => 'A stopwatch on a white background' },
    });
    const getGenerativeModel = vi.fn().mockReturnValue({ generateContent });
    const fakeClient = { getGenerativeModel } as unknown as GoogleGenerativeAI;

    await generateAltText(fakeClient, {
      imageBuffer: Buffer.from([1, 2, 3]),
      mimeType: 'image/jpeg',
      productName: 'Kitchen Mug',
      reviewerHint: 'this is actually a stopwatch, not a mug',
    });

    const [parts] = generateContent.mock.calls[0];
    expect(parts[1].text).toContain('this is actually a stopwatch, not a mug');
  });

  it('omits any hint mention when reviewerHint is not provided', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      response: { text: () => 'A red widget' },
    });
    const getGenerativeModel = vi.fn().mockReturnValue({ generateContent });
    const fakeClient = { getGenerativeModel } as unknown as GoogleGenerativeAI;

    await generateAltText(fakeClient, {
      imageBuffer: Buffer.from([1, 2, 3]),
      mimeType: 'image/jpeg',
      productName: 'Red Widget',
    });

    const [parts] = generateContent.mock.calls[0];
    expect(parts[1].text).not.toContain('reviewer');
  });
});
