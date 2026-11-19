export interface Front { attrs: Record<string, string | string[]>; body: string }
const unquote = (s: string) => s.replace(/^(["'])(.*)\1$/, "$2");

/**
 * Supports: `key: value`, `key: [a, b]`, `key:` + `- item` lines, ONE level of nesting (`triggers:` + `  globs: [...]`
 * becomes "triggers.globs"), and block scalars `>`, `>-`, `|`, `|-` (V3Code's skill descriptions use them).
 * Anything else is ignored, never thrown.
 */
export function parseFrontmatter(src: string): Front {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(src);
  if (!m) return { attrs: {}, body: src };
  const attrs: Record<string, string | string[]> = {};
  let parent: string | null = null, listKey: string | null = null;
  let block: { key: string; fold: boolean; lines: string[] } | null = null;
  const endBlock = () => { if (block) attrs[block.key] = block.lines.join(block.fold ? " " : "\n").trim(); block = null; };
  for (const line of m[1]!.split(/\r?\n/)) {
    if (block && (/^\s+\S/.test(line) || line.trim() === "")) { block.lines.push(line.trim()); continue; }
    endBlock();
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) { (attrs[listKey] as string[]).push(unquote(item[1]!.trim())); continue; }
    const kv = /^(\s*)([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const nested: boolean = kv[1]!.length > 0 && parent !== null;
    const key: string = nested ? `${parent}.${kv[2]}` : kv[2]!;
    const v = kv[3]!.trim();
    if (!nested) parent = null;
    listKey = null;
    if (v === "") { attrs[key] = []; listKey = key; if (!nested) parent = key; continue; }
    if (/^[>|]-?$/.test(v)) { block = { key, fold: v.startsWith(">"), lines: [] }; continue; }
    attrs[key] = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(",").map((s) => unquote(s.trim())).filter(Boolean) : unquote(v);
  }
  endBlock();
  return { attrs, body: src.slice(m[0].length) };
}
/** Reads `triggers.globs` (V3Code) or `globs` (Devin), as a list. */
export const listAttr = (a: Front["attrs"], key: string): string[] => { const v = a[`triggers.${key}`] ?? a[key]; return Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",").map((s) => s.trim()) : []; };
export const boolAttr = (a: Front["attrs"], key: string): boolean => String(a[`triggers.${key}`] ?? a[key] ?? "").toLowerCase() === "true";
