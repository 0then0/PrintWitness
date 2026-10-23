// Preserve case, punctuation and numbers. Compatibility normalization handles PDF ligatures.
export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u00ad\u200b\ufeff]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}
