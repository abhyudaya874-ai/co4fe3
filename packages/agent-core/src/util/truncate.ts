/** Cuts `text` to `max` chars on a line boundary and appends a note naming what was cut and how to get it. */
export function truncateWithHint(text: string, max: number, hint: string): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf("\n", max);
  const kept = text.slice(0, cut > max * 0.5 ? cut : max);
  return `${kept}\n…(truncated: ${text.length - kept.length} more characters. ${hint})`;
}
