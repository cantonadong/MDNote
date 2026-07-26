const CJK_RANGE = /[㐀-䶿一-鿿豈-﫿]/g;

// Chinese/CJK counted per character, everything else counted per
// whitespace-delimited word (matches the need.md "中文按字 / 英文按词" spec).
export function countWords(text: string): number {
  const cjkChars = text.match(CJK_RANGE) ?? [];
  const rest = text.replace(CJK_RANGE, " ").trim();
  const words = rest.length > 0 ? rest.split(/\s+/) : [];
  return cjkChars.length + words.length;
}
