import type { Problem } from "../host.js";
import { pickProblems } from "../review/verify.js";
import { estimateTokens } from "./tokens.js";

export type PackTask = "understand" | "refactor" | "debug" | "extend";
/** V3Code's per-task caps (credited design parameters): callers, references, lines of context per caller. */
export const TASK_CAPS: Record<PackTask, { callers: number; references: number; callerLines: number }> = {
  understand: { callers: 3, references: 4, callerLines: 8 },
  refactor: { callers: 10, references: 8, callerLines: 4 },
  debug: { callers: 6, references: 4, callerLines: 6 },
  extend: { callers: 4, references: 2, callerLines: 4 },
};
export interface SymbolFacts {
  symbol: { name: string; path: string; line: number; endLine: number };
  definition: string; signature: string; problems: Problem[];
  callers: { from: string; path: string; line: number; snippet: string[] }[];
  references: { path: string; line: number; snippet: string[] }[];
  source: "lsp" | "index";                                            // "index" = no language server answered; built from symbols.ts + rg
}
export interface SymbolPack extends SymbolFacts { task: PackTask; tokens: number; dropped: { references: number; callerSnippets: number; callers: number } }

/** Trim order, as in V3Code: references, then caller snippets, then callers. The definition is cut at 2 × budget chars with a note. */
export function shapeSymbolPack(f: SymbolFacts, task: PackTask, maxTokens: number): SymbolPack {
  const caps = TASK_CAPS[task], budget = Math.max(500, maxTokens);
  const p: SymbolPack = { ...f, task, tokens: 0, callers: f.callers.slice(0, caps.callers).map((c) => ({ ...c, snippet: c.snippet.slice(0, caps.callerLines) })), references: f.references.slice(0, caps.references), problems: pickProblems(f.problems), dropped: { references: Math.max(0, f.references.length - caps.references), callerSnippets: 0, callers: Math.max(0, f.callers.length - caps.callers) } };
  if (p.definition.length > budget * 2) p.definition = p.definition.slice(0, budget * 2) + "\n[Definition truncated: ask pack_context for a narrower symbol, or read_file with offset.]";
  const size = () => estimateTokens(renderSymbolPack(p));
  while (size() > budget && p.references.length) { p.references.pop(); p.dropped.references++; }
  for (let i = p.callers.length - 1; size() > budget && i >= 0; i--) if (p.callers[i]!.snippet.length) { p.callers[i]!.snippet = []; p.dropped.callerSnippets++; }
  while (size() > budget && p.callers.length) { p.callers.pop(); p.dropped.callers++; }
  p.tokens = size();
  return p;
}

export function renderSymbolPack(p: SymbolPack): string {
  const parts = [`## ${p.symbol.name} (${p.symbol.path}:${p.symbol.line + 1}, from ${p.source})`];
  if (p.signature) parts.push(`signature: ${p.signature}`);
  parts.push(p.definition.trimEnd());
  if (p.problems.length) parts.push(`problems:\n${p.problems.map((x) => `- line ${x.line + 1} [${x.severity}] ${x.message}`).join("\n")}`);
  for (const c of p.callers) parts.push(`caller ${c.from} (${c.path}:${c.line + 1})${c.snippet.length ? `:\n${c.snippet.join("")}` : ""}`);
  for (const r of p.references) parts.push(`reference ${r.path}:${r.line + 1}${r.snippet.length ? `:\n${r.snippet.join("")}` : ""}`);
  const d = p.dropped;
  const drops = d.references + d.callerSnippets + d.callers;
  if (drops) parts.push(`dropped: ${d.references} references, ${d.callerSnippets} caller snippets, ${d.callers} callers (over the token budget)`);
  return parts.join("\n");
}

/** Keeps the fenced code block of a hover (V3Code's extractHoverSignature idea); falls back to the first line. */
export function extractHoverSignature(contents: readonly string[], cap = 200): string {
  const joined = contents.join("\n");
  const fence = /```[\w-]*\n([\s\S]*?)```/.exec(joined);
  const sig = (fence?.[1] ?? joined).trim().split("\n").filter((l) => l.trim())[0] ?? "";
  return sig.slice(0, cap);
}
