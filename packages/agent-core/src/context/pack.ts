import type { FileEntry, Ranked, RepoIndex } from "./repomap.js";
import type { Pin } from "./mentions.js";
import { estimateTokens } from "./tokens.js";

export interface PackItem { path: string; why: string[]; tokens: number; text: string; pinned: boolean; mode: "outline" | "full" | "slice" }
export interface ContextPack { items: PackItem[]; used: number; budget: number; skipped: { path: string; why: string }[]; path: "full" | "quick" | "none" }
export const EMPTY_PACK: ContextPack = { items: [], used: 0, budget: 0, skipped: [], path: "none" };

// "hi", "thanks", "yes, go ahead": no code question, so no repo map. The session's history carries a follow-up.
const SMALL_TALK = /^(hi+|hello|hey+|yo|sup|hiya|thanks?|thank you|thx|ty|ok(ay)?|k|cool|nice|great|good( (morning|afternoon|evening|night))?|bye|yes|yep|yeah|no|nope|sure|go( ahead)?|do it|continue|proceed|carry on|stop|wait|who are you|what can you do|how are you)$/i;
/** Whether a message gets a context pack. Mentions or an attached selection always do; small talk and one-word follow-ups do not. */
export function wantsPack(text: string, attached = false): boolean {
  if (attached || /@[\w.]/.test(text)) return true;
  const t = text.trim().replace(/[\s!?.,:;)(*~-]+$/g, "").replace(/^[\s,]+/, "").replace(/\s+/g, " ");
  if (!t) return false;
  const parts = t.replace(/\b(please|pls)\b/gi, "").split(/[,;!.]+/).map((p) => p.trim()).filter(Boolean);   // "yes, go ahead please"
  return !parts.length ? false : !parts.every((p) => SMALL_TALK.test(p));
}

export const outlineOf = (f: FileEntry, max = 40): string =>
  f.syms.slice(0, max).map((s) => `L${s.line}`.padEnd(6) + (s.parent ? "    " : "") + s.sig).join("\n") + (f.syms.length > max ? `\n… ${f.syms.length - max} more symbols` : "");

/** The pack as it is sent in the first user message (rule 40): a map, not the files. */
export function renderPack(p: ContextPack): string {
  if (!p.items.length) return "";
  const rows = p.items.map((i) => `## ${i.path} — ${i.why.join("; ")}\n${i.text}`).join("\n");
  return `<context_pack budget="${p.budget}" used="${p.used}">\n${rows}\n</context_pack>\nThe pack is a map, not the files. Read a file with read_file (or pack_context for one symbol) before editing it.`;
}

const itemTokens = (path: string, why: readonly string[], text: string): number => estimateTokens(`## ${path} — ${why.join("; ")}\n${text}\n`);

const fileItem = (ix: RepoIndex, path: string, mode: PackItem["mode"], why: string[], pinned: boolean): PackItem => {
  const f = ix.byPath.get(path);
  const text = f ? (mode === "full" ? f.text : outlineOf(f)) : "";
  return { path, why, tokens: itemTokens(path, why, text), text, pinned, mode };
};

/** A mentioned symbol: its definition lines, ending at the next symbol or an 80-line window (V3Code's chunker fallback). */
const sliceItem = (ix: RepoIndex, pin: Extract<Pin, { kind: "symbol" }>): PackItem => {
  const f = ix.byPath.get(pin.path);
  const sym = f?.syms.find((s) => s.name === pin.name);
  if (!f || !sym) return fileItem(ix, pin.path, "outline", [`mentioned by you: ${pin.name} (not found in the index — outline shown)`], true);
  const lines = f.text.split("\n");
  const next = f.syms.filter((s) => s.line > sym.line && (s.parent ?? "") === (sym.parent ?? "")).sort((a, b) => a.line - b.line)[0];
  const end = Math.min((next?.line ?? sym.line + 80) - 1, sym.line + 79, lines.length);
  const text = lines.slice(sym.line - 1, end).join("\n") + (end < lines.length && !next ? "\n…(80-line window: read_file for the rest)" : "");
  return { path: pin.path, why: [`mentioned by you: ${pin.name}`], tokens: itemTokens(pin.path, [pin.name], text), text, pinned: true, mode: "slice" };
};

export function assemblePack(ix: RepoIndex, ranked: Ranked[], pins: Pin[], budget: number): Omit<ContextPack, "path"> {
  const items: PackItem[] = [];
  let used = 0;
  const add = (it: PackItem) => { if (used + it.tokens <= budget) { items.push(it); used += it.tokens; return true; } return false; };
  for (const p of pins) {
    if (!ix.byPath.has(p.path)) continue;
    const fits = p.kind === "symbol" ? add(sliceItem(ix, p)) : add(fileItem(ix, p.path, "full", ["mentioned by you"], true));
    if (!fits) add(fileItem(ix, p.path, "outline", [`mentioned by you (${p.kind === "symbol" ? p.name + " " : ""}too large: outline shown)`], true));
  }
  const skipped: ContextPack["skipped"] = [];
  for (const r of ranked) {
    if (items.some((i) => i.path === r.path)) continue;
    if (!add(fileItem(ix, r.path, "outline", r.why, false))) skipped.push({ path: r.path, why: "over budget" });
    if (items.length >= 12) break;
  }
  return { items, used, budget, skipped: skipped.slice(0, 5) };
}
