import type { Ranked } from "./repomap.js";
import type { Pin } from "./mentions.js";

export interface PackItem { path: string; why: string[]; tokens: number; text: string; pinned: boolean; mode: "outline" | "full" | "slice" }
export interface ContextPack { items: PackItem[]; used: number; budget: number; skipped: { path: string; why: string }[]; path: "full" | "quick" | "none" }
export const EMPTY_PACK: ContextPack = { items: [], used: 0, budget: 0, skipped: [], path: "none" };

/** The pack as it is sent in the first user message (rule 40): a map, not the files. */
export function renderPack(p: ContextPack): string {
  if (!p.items.length) return "";
  const rows = p.items.map((i) => `## ${i.path} — ${i.why.join("; ")}\n${i.text}`).join("\n");
  return `<context_pack budget="${p.budget}" used="${p.used}">\n${rows}\n</context_pack>\nThe pack is a map, not the files. Read a file with read_file (or pack_context for one symbol) before editing it.`;
}

