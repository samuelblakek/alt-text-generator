import { describe, it, expect } from 'vitest';
import { validateAltText, computeDuplicateWithinProduct } from '../../../src/lib/validator/validateAltText';

describe('validateAltText', () => {
  it('flags length outside the 40-125 character range', () => {
    expect(validateAltText('Too short', 'Widget').lengthOk).toBe(false);
    expect(
      validateAltText(
        'A bright red plastic widget standing upright on a plain white table in natural light',
        'Widget'
      ).lengthOk
    ).toBe(true);
    expect(
      validateAltText(
        'A'.repeat(126),
        'Widget'
      ).lengthOk
    ).toBe(false);
  });

  it('flags banned openers case-insensitively', () => {
    expect(validateAltText('Image of a red widget on a table surface', 'Widget').bannedPhrase).toBe(true);
    expect(validateAltText('picture of a red widget on a table surface', 'Widget').bannedPhrase).toBe(true);
    expect(validateAltText('A red widget standing on a wooden table surface', 'Widget').bannedPhrase).toBe(
      false
    );
  });

  it('flags alt text that is just the bare product name', () => {
    expect(validateAltText('Widget', 'Widget').isDuplicateOfProductName).toBe(true);
    expect(validateAltText('  widget  ', 'Widget').isDuplicateOfProductName).toBe(true);
    expect(validateAltText('A red widget on a table', 'Widget').isDuplicateOfProductName).toBe(false);
  });
});

describe('computeDuplicateWithinProduct', () => {
  it('flags entries that share identical text (case/whitespace insensitive)', () => {
    const result = computeDuplicateWithinProduct([
      { id: 1, text: 'A red widget on a table' },
      { id: 2, text: '  a red widget on a table  ' },
      { id: 3, text: 'A red widget from the side' },
    ]);
    expect(result.get(1)).toBe(true);
    expect(result.get(2)).toBe(true);
    expect(result.get(3)).toBe(false);
  });

  it('does not flag empty strings as duplicates of each other', () => {
    const result = computeDuplicateWithinProduct([
      { id: 1, text: '' },
      { id: 2, text: '' },
    ]);
    expect(result.get(1)).toBe(false);
    expect(result.get(2)).toBe(false);
  });
});
