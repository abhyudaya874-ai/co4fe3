import { splitLines, eolOf } from "./lines.js";
import { estimateTokens } from "../context/tokens.js";
import { pickProblems, renderProblem, type Problem } from "./verify.js";

/** The whole lines (0-based, inclusive) a selection covers. One that ends at column 0 of a later line does not include that line:
 *  Shift+Down and a triple click both end there, and the untouched line must not become part of the edit. */
export function selectedLines(sel: { start: { line: number; character: number }; end: { line: number; character: number } }): { start: number; end: number } {
  const end = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line - 1 : sel.end.line;
  return { start: sel.start.line, end };
}

/** A reply with no code fence that reads like a sentence ("Sure! Here is…", "The function does:") instead of like code.
 *  The inline prompt asks for one fenced block; when a model answers in words, those words must not become the replacement. */
export function looksLikeProse(text: string): boolean {
  const t = text.trim();
  if (!t || t.includes("```")) return false;
  const first = t.split("\n")[0]!.trim();
  if (/^(sure|certainly|of course|okay|ok|here|i['’]?ll|i['’]?m|i would|i can|i have|i['’]?ve|let me|below|note|unfortunately|sorry|you can|you could|to do|to make|the (code|function|method|class|selected|following|updated)|this (code|function|will|is|should))\b/i.test(first)) return true;
  return first.endsWith(":") && first.split(/\s+/).length >= 4 && !/[(){}\[\]=;]/.test(first);
}

/** Body of the first ``` fence. `complete` once the closing fence arrived. With no fence, the whole text counts once the turn is done. */
export function extractFence(s: string, done: boolean): { code: string; complete: boolean } | null {
  const open = /```[\w+-]*[ \t]*\r?\n/.exec(s);
  if (!open) return done ? { code: s, complete: true } : null;
  const start = open.index + open[0].length;
  const close = s.indexOf("\n```", start - 1);              // start-1 also catches an empty body
  if (close === -1) return { code: s.slice(start), complete: done };
  return { code: s.slice(start, close + 1), complete: true };
}

/** While streaming: finished new lines, then the original lines not yet covered, so the diff grows top-down. */
export function streamingPreview(original: string, partial: string): string {
  const a = splitLines(original), b = splitLines(partial);
  const done = partial.endsWith("\n") ? b : b.slice(0, -1);  // hide the half-written last line
  return [...done, ...a.slice(done.length)].join("");
}

/** Whole lines [start, end] of `text` replaced by `code`. Keeps the file's EOL and the selection's final newline. */
export function assembleInline(text: string, start: number, end: number, code: string): string {
  const lines = splitLines(text), eol = eolOf(text);
  let body = code.replace(/\r?\n/g, eol);
  const selected = lines.slice(start, end + 1).join("");
  if (selected.endsWith("\n") && !body.endsWith("\n")) body += eol;
  return lines.slice(0, start).join("") + body + lines.slice(end + 1).join("");
}

export interface InlinePromptInput {
  path: string; lang: string; instruction: string; text: string; start: number; end: number;
  outline: string; problems: Problem[]; budget: number;
}

/** The Ctrl+K prompt (V3Code's shape): selection, prefix and suffix in tags, "return only the code block". Drops
 *  context lines (40 → 20 → 10 → 0 each side) until it fits `budget`; problems are dropped before context lines. */
export function buildInlinePrompt(i: InlinePromptInput): string {
  const lines = splitLines(i.text);
  const selected = lines.slice(i.start, i.end + 1).join("");
  const problems = pickProblems(i.problems.filter((p) => p.line >= i.start - 60 && p.line <= i.end + 60));
  const render = (ctx: number, withProblems: boolean): string => {
    const parts = [
      `File: ${i.path} (${i.lang})`,
      `Instruction: ${i.instruction}`,
      `Rewrite ONLY the selected lines ${i.start + 1}-${i.end + 1}. Reply with the complete replacement for those lines inside one \`\`\`${i.lang} fenced block, keeping the original indentation. No explanation.`,
      i.outline ? `<outline>${i.outline}</outline>` : "",
      withProblems && problems.length ? `<problems>${problems.map(renderProblem).join("\n")}</problems>` : "",
      `<before>${lines.slice(Math.max(0, i.start - ctx), i.start).join("")}</before>`,
      `<selected>${selected}</selected>`,
      `<after>${lines.slice(i.end + 1, i.end + 1 + ctx).join("")}</after>`,
    ];
    return parts.filter(Boolean).join("\n");
  };
  for (const ctx of [40, 20, 10, 0]) {
    const withP = render(ctx, true);
    if (estimateTokens(withP) <= i.budget) return withP;
    const withoutP = render(ctx, false);
    if (estimateTokens(withoutP) <= i.budget) return withoutP;
  }
  return render(0, false);
}

/** Monotonic run state, after V3Code's turboDraftRunState: phases only move forward; terminal phases are sticky. */
export type InlinePhase = "reading" | "drafting" | "reviewing" | "applied" | "noChanges" | "sourceChanged" | "cancelled" | "error";
const ORDER: InlinePhase[] = ["reading", "drafting", "reviewing", "applied"];
const TERMINAL = new Set<InlinePhase>(["applied", "noChanges", "sourceChanged", "cancelled", "error"]);
export function canAdvance(from: InlinePhase, to: InlinePhase): boolean {
  if (from === to) return true;
  if (TERMINAL.has(from)) return false;                   // sticky
  if (TERMINAL.has(to)) return true;                      // any live phase may end
  return ORDER.indexOf(to) > ORDER.indexOf(from);         // forward only
}

/** Throws on an illegal move: that is a bug, not a user error. */
export class PhaseBox {
  constructor(private current: InlinePhase, private onChange: (p: InlinePhase) => void) {}
  get phase(): InlinePhase { return this.current; }
  to(p: InlinePhase): void {
    if (!canAdvance(this.current, p)) throw new Error(`inline phase ${this.current} → ${p} refused (canAdvance)`);
    if (this.current !== p) { this.current = p; this.onChange(p); }
  }
}
