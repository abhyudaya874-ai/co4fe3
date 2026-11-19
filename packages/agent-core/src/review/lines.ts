/** Splits keeping each line's own terminator ("\n" or "\r\n"), so join("") gives back the exact bytes. */
export const splitLines = (s: string): string[] => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];
export const eolOf = (s: string): "\r\n" | "\n" => (/\r\n/.test(s) ? "\r\n" : "\n");
