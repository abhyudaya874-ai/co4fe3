/** chars per token falls as punctuation rises (code ≈ 3, prose ≈ 4.3); non-ASCII costs ~0.7 token per char. */
export function estimateTokens(s: string): number {
  let ascii = 0, punct = 0, other = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 128) { other++; continue; }
    ascii++;
    const word = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 32 || c === 10 || c === 9 || c === 13;
    if (!word) punct++;
  }
  const perTok = Math.max(2.8, 4.3 - 3.2 * (ascii ? punct / ascii : 0));
  return Math.ceil(ascii / perTok + other * 0.7);
}
