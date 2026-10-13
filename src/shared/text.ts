/**
 * Splits a comma-separated list typed in settings (trigger phrases, STT terms) into trimmed items,
 * without empty ones and repeats (case and «ё» ignored).
 */
export function parseCommaList(text: string): string[] {
  const phrases = text
    .split(',')
    .map((p) => p.trim().replace(/\s+/g, ' '))
    .filter((p) => /[\p{L}\p{N}]/u.test(p));
  const seen = new Set<string>();
  return phrases.filter((p) => {
    const key = p.toLowerCase().replace(/ё/g, 'е');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
