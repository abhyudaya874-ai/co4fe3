import { eolOf } from "./lines.js";

export interface EditOp { oldString: string; newString: string }
export type EditReject = "no-file" | "empty" | "not-found" | "not-unique" | "unchanged" | "too-large" | "overlap" | "noop";
export type Plan = { ok: true; after: string } | { ok: false; error: string; reasons: { op: number; reason: EditReject }[] };
export const MAX_EDIT_CHARS = 12_000;      // per old_string/new_string (V3Code's block cap)

const MESSAGE: Record<EditReject, (n: number, x: string) => string> = {
  "no-file": () => "The file does not exist. To create it, call propose_edit with `content` instead of `edits`.",
  empty: (n) => `edits[${n}].old_string is empty. Copy the exact lines to replace from read_file output.`,
  "not-found": (n, hint) => `edits[${n}].old_string was not found. Call read_file again and copy the text exactly, including indentation.${hint}`,
  "not-unique": (n, lines) => `edits[${n}].old_string matches several places (lines ${lines}). Add surrounding lines so it matches exactly one.`,
  unchanged: (n) => `edits[${n}] has old_string equal to new_string. Remove it.`,
  "too-large": (n) => `edits[${n}] is over ${MAX_EDIT_CHARS} characters. Split it into smaller edits.`,
  overlap: (n) => `edits[${n}] overlaps an earlier edit. Merge the two into one edit.`,
  noop: () => "These edits change nothing. Do not repeat them.",
};

const indicesOf = (haystack: string, needle: string): number[] => {
  const out: number[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) out.push(at);
  return out;
};
const lineAt = (text: string, at: number): number => text.slice(0, at).split("\n").length;   // 1-based
const nearest = (text: string, needle: string): string => {
  const probe = needle.split("\n")[0]!.slice(0, 40);
  if (probe.length < 4) return "";
  const at = text.indexOf(probe);
  return at === -1 ? "" : ` The closest line is ${lineAt(text, at)}: "${text.slice(at, at + 40).split("\n")[0]}"`;
};
const fail = (bad: { op: number; reason: EditReject; detail: string }[]): Plan =>
  ({ ok: false, error: bad.map((b) => MESSAGE[b.reason](b.op, b.detail)).join("\n"), reasons: bad.map(({ op, reason }) => ({ op, reason })) });

/** `content` creates or replaces the whole file. Otherwise each op must match the ORIGINAL text exactly once, and ops may not overlap. */
export function planEdit(before: string | null, ops: readonly EditOp[], content?: string): Plan {
  if (content !== undefined) return { ok: true, after: content };
  if (before === null) return fail([{ op: 0, reason: "no-file", detail: "" }]);
  const eol = eolOf(before);
  const bad: { op: number; reason: EditReject; detail: string }[] = [];
  const spans: { start: number; end: number; repl: string; op: number }[] = [];
  for (const [n, op] of ops.entries()) {
    const find = op.oldString.replace(/\r?\n/g, eol), repl = op.newString.replace(/\r?\n/g, eol);
    if (find === "") { bad.push({ op: n, reason: "empty", detail: "" }); continue; }
    if (find === repl) { bad.push({ op: n, reason: "unchanged", detail: "" }); continue; }
    if (find.length > MAX_EDIT_CHARS || repl.length > MAX_EDIT_CHARS) { bad.push({ op: n, reason: "too-large", detail: "" }); continue; }
    const at = indicesOf(before, find);
    if (at.length === 0) { bad.push({ op: n, reason: "not-found", detail: nearest(before, find) }); continue; }
    if (at.length > 1) { bad.push({ op: n, reason: "not-unique", detail: at.map((i) => lineAt(before, i)).join(", ") }); continue; }
    const span = { start: at[0]!, end: at[0]! + find.length, repl, op: n };
    if (spans.some((s) => span.start < s.end && s.start < span.end)) { bad.push({ op: n, reason: "overlap", detail: "" }); continue; }
    spans.push(span);
  }
  if (bad.length) return fail(bad);
  let after = before;
  for (const s of [...spans].sort((a, b) => b.start - a.start)) after = after.slice(0, s.start) + s.repl + after.slice(s.end);   // back to front keeps offsets valid
  return after === before ? fail([{ op: 0, reason: "noop", detail: "" }]) : { ok: true, after };
}
