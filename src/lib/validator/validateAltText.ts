export interface AltTextFlags {
  lengthOk: boolean;
  bannedPhrase: boolean;
  isDuplicateOfProductName: boolean;
}

const BANNED_OPENERS = [/^image of\b/i, /^picture of\b/i, /^photo of\b/i];

export function validateAltText(altText: string, productName: string): AltTextFlags {
  const trimmed = altText.trim();
  return {
    lengthOk: trimmed.length >= 40 && trimmed.length <= 125,
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
