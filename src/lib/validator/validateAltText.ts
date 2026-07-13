export interface AltTextFlags {
  wordCountOk: boolean;
  bannedPhrase: boolean;
  isDuplicateOfProductName: boolean;
}

const BANNED_OPENERS = [/^image of\b/i, /^picture of\b/i, /^photo of\b/i];

export function validateAltText(altText: string, productName: string): AltTextFlags {
  const trimmed = altText.trim();
  const wordCount = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  return {
    wordCountOk: wordCount >= 8 && wordCount <= 12,
    bannedPhrase: BANNED_OPENERS.some((re) => re.test(trimmed)),
    isDuplicateOfProductName: trimmed.toLowerCase() === productName.trim().toLowerCase(),
  };
}

export function computeDuplicateWithinProduct(
  altTexts: { id: number; text: string }[]
): Map<number, boolean> {
  const counts = new Map<string, number>();
  for (const { text } of altTexts) {
    const key = text.trim().toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const result = new Map<number, boolean>();
  for (const { id, text } of altTexts) {
    const key = text.trim().toLowerCase();
    result.set(id, key.length > 0 && (counts.get(key) ?? 0) > 1);
  }
  return result;
}
