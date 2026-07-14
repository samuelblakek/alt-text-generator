export function normalizeUrlPath(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname);
  } catch {
    return url;
  }
}

export function urlPathsMatch(a: string, b: string): boolean {
  return normalizeUrlPath(a) === normalizeUrlPath(b);
}
