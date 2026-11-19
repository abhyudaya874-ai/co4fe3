import type { RepoIndex } from "./repomap.js";

export type Pin = { kind: "file"; path: string } | { kind: "symbol"; name: string; path: string; line: number };

const MENTION = /@(symbol:[\w$]+|[\w][\w./-]*[\w])/g;

/**
 * "@src/flask/cli.py" pins a file, "@symbol:FlaskGroup" pins a symbol's slice.
 * Resolved tokens leave `clean`; unknown mentions stay in the text and come back in `unresolved` — shown, never dropped silently.
 */
export function parseMentions(text: string, ix: RepoIndex): { pins: Pin[]; unresolved: string[]; clean: string } {
  const pins: Pin[] = [];
  const unresolved: string[] = [];
  const clean = text.replace(MENTION, (tok, m: string) => {
    if (m.startsWith("symbol:")) {
      const name = m.slice(7);
      const def = ix.defs.get(name)?.[0];
      if (def) { pins.push({ kind: "symbol", name, path: def.path, line: def.line }); return ""; }
      unresolved.push(m);
      return tok;
    }
    const path = ix.byPath.has(m) ? m : [...ix.byPath.keys()].filter((p) => p.endsWith(`/${m}`)).sort()[0];
    if (path) { pins.push({ kind: "file", path }); return ""; }
    unresolved.push(m);
    return tok;
  }).replace(/[ \t]{2,}/g, " ");
  return { pins, unresolved, clean };
}
