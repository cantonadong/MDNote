const WORD_OR_CJK = /[㐀-䶿一-鿿豈-﫿]|[^\s㐀-䶿一-鿿豈-﫿]+/g;

// Chinese/CJK counted per character, everything else counted per
// whitespace-delimited word (matches the need.md "中文按字 / 英文按词" spec).
export function countWords(text: string): number {
  let count = 0;
  // Match each CJK character or each run of other non-whitespace text in
  // one pass, without copying the document or retaining a word array.
  WORD_OR_CJK.lastIndex = 0;
  while (WORD_OR_CJK.exec(text) !== null) count++;
  return count;
}
