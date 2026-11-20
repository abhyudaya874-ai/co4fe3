import type { RepoIndex } from "./repomap.js";

export type Pin = { kind: "file"; path: string } | { kind: "symbol"; name: string; path: string; line: number };

// @symbol:Name · @rule:/@skill:/@workflow:name (instructions/load.ts instructionMentions handles those) · @path · @folder/
const MENTION = /@(symbol:[\w$]+|(?:rule|skill|workflow):[\w-]+|[\w.][\w./-]*[\w]\/?)/g;
export const MAX_FOLDER_FILES = 8;                                    // files a folder mention may boost in the ranking

/**
 * "@src/flask/cli.py" pins a file, "@symbol:FlaskGroup" pins a symbol's slice, "@src/flask/" names a folder: its files
 * rank first (up to MAX_FOLDER_FILES) and the text keeps the folder so the model sees it.
 * Resolved file and symbol tokens leave `clean`; unknown mentions stay in the text and come back in `unresolved`.
 */
export function parseMentions(text: string, ix: RepoIndex): { pins: Pin[]; folders: string[]; folderFiles: string[]; unresolved: string[]; clean: string } {
  const pins: Pin[] = [];
  const folders: string[] = [];
  const unresolved: string[] = [];
  const clean = text.replace(MENTION, (tok, m: string) => {
    if (/^(rule|skill|workflow):/.test(m)) return tok;
    if (m.startsWith("symbol:")) {
      const name = m.slice(7);
      const def = ix.defs.get(name)?.[0];
      if (def) { pins.push({ kind: "symbol", name, path: def.path, line: def.line }); return ""; }
      unresolved.push(m);
      return tok;
    }
    const bare = m.replace(/\/$/, "");
    const path = m.endsWith("/") ? undefined : ix.byPath.has(bare) ? bare : [...ix.byPath.keys()].filter((p) => p.endsWith(`/${bare}`)).sort()[0];
    if (path) { pins.push({ kind: "file", path }); return ""; }
    if ([...ix.byPath.keys()].some((p) => p.startsWith(`${bare}/`))) { folders.push(bare); return `${bare}/`; }
    unresolved.push(m);
    return tok;
  }).replace(/[ \t]{2,}/g, " ");
  const folderFiles = [...new Set(folders.flatMap((f) => [...ix.byPath.keys()].filter((p) => p.startsWith(`${f}/`)).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b)).slice(0, MAX_FOLDER_FILES)))];
  return { pins, folders, folderFiles, unresolved, clean };
}
