import type { RepoIndex } from "./repomap.js";
import type { Instruction } from "../instructions/load.js";
import type { CompletionItem } from "../panel/protocol.js";

// The composer's "@" and "/" menus, Devin-style: open files first, then files and folders, symbols, rules and skills.
// Pure: the host passes the file list, the index, the instructions and what is open.

export const MAX_COMPLETIONS = 50;

const base = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
const dir = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** Higher is better; -1 is no match. Base-name hits beat path hits; a fuzzy in-order match is the last resort. */
export function matchScore(path: string, q: string): number {
  if (!q) return 0;
  const p = path.toLowerCase(), b = base(p), s = q.toLowerCase();
  if (b === s) return 100;
  if (b.startsWith(s)) return 80;
  if (p === s || p.startsWith(s)) return 70;
  if (b.includes(s)) return 60;
  if (p.split("/").some((seg) => seg.startsWith(s))) return 40;
  if (p.includes(s)) return 20;
  let i = 0;
  for (const c of p) if (c === s[i]) i++;
  return i === s.length ? 5 : -1;
}

const folderSet = (files: readonly string[]): string[] => {
  const out = new Set<string>();
  for (const f of files) { let d = dir(f); while (d) { out.add(d); d = dir(d); } }
  return [...out];
};

const describe = (i: Instruction): string => i.description || i.path;
const KIND_ORDER: Record<Instruction["kind"], number> = { rule: 0, skill: 1, workflow: 2, file: 3 };

export interface MentionQuery {
  prefix: string;
  files: readonly string[];            // every workspace file (not only the indexed ones)
  ix: RepoIndex | null;
  instructions: readonly Instruction[];
  open: readonly string[];             // active editor first, then the other visible editors, then this session's edits
}

/** The "@" menu. An empty prefix lists open files, top-level folders, rules and skills, then files, shortest first. */
export function completeMention(q: MentionQuery, max = MAX_COMPLETIONS): CompletionItem[] {
  const s = q.prefix.trim();
  const out: CompletionItem[] = [];
  const seen = new Set<string>();
  const push = (c: CompletionItem): void => { const k = `${c.kind}:${c.insert}`; if (!seen.has(k) && out.length < max) { seen.add(k); out.push(c); } };
  const fileRow = (p: string, group: CompletionItem["group"]): CompletionItem => ({ kind: "file", label: base(p), detail: dir(p), insert: p, group });

  const all = [...new Set([...q.files, ...(q.ix ? [...q.ix.byPath.keys()] : [])])];
  const open = [...new Set(q.open)].filter((p) => all.includes(p) && matchScore(p, s) >= (s ? 20 : 0));
  for (const p of open.slice(0, 6)) push(fileRow(p, "Open files"));

  const instr = q.instructions.filter((i) => i.kind === "rule" || i.kind === "skill" || i.kind === "workflow")
    .map((i) => ({ i, score: s ? Math.max(matchScore(i.name, s), matchScore(`${i.kind}:${i.name}`, s)) : 0 }))
    .filter((x) => x.score >= (s ? 20 : 0)).sort((a, b) => b.score - a.score || KIND_ORDER[a.i.kind] - KIND_ORDER[b.i.kind] || a.i.name.localeCompare(b.i.name));
  const instrRows = instr.map(({ i }) => ({ kind: i.kind as "rule" | "skill" | "workflow", label: i.name, detail: `${i.kind} · ${describe(i)}`, insert: `${i.kind}:${i.name}`, group: "Rules & skills" as const }));

  const folders = folderSet(all);
  if (!s) {
    for (const f of folders.filter((f) => !f.includes("/")).sort()) push({ kind: "folder", label: `${f}/`, detail: "folder", insert: `${f}/`, group: "Files & folders" });
    const hidden = (p: string): number => Number(p.startsWith("."));               // dot-folders (.github, .devin) after the code
    for (const p of [...all].sort((a, b) => hidden(a) - hidden(b) || a.split("/").length - b.split("/").length || a.localeCompare(b)).slice(0, 20)) push(fileRow(p, "Files & folders"));
    for (const r of instrRows) push(r);
    return out;
  }
  const paths = [
    ...all.map((p) => ({ p, folder: false, score: matchScore(p, s) })),
    ...folders.map((p) => ({ p, folder: true, score: matchScore(p, s) })),
  ].filter((x) => x.score >= 0).sort((a, b) => b.score - a.score || a.p.length - b.p.length || a.p.localeCompare(b.p));
  for (const x of paths.slice(0, 30)) push(x.folder ? { kind: "folder", label: `${base(x.p)}/`, detail: dir(x.p) || "folder", insert: `${x.p}/`, group: "Files & folders" } : fileRow(x.p, "Files & folders"));
  if (q.ix && s.length >= 2) {
    const syms = [...q.ix.defs.entries()].map(([name, defs]) => ({ name, def: defs[0], score: matchScore(name, s) }))
      .filter((x) => x.def && x.score >= 40).sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name)).slice(0, 8);
    for (const x of syms) push({ kind: "symbol", label: x.name, detail: `${x.def!.path}:${x.def!.line}`, insert: `symbol:${x.name}`, group: "Symbols" });
  }
  for (const r of instrRows.slice(0, 6)) push(r);
  return out;
}

/** The "/" menu: workflows, then skills (Devin invokes a skill with /name). */
export function completeSlash(instructions: readonly Instruction[], prefix: string, max = MAX_COMPLETIONS): CompletionItem[] {
  const s = prefix.toLowerCase();
  const rows = (kind: "workflow" | "skill", group: "Workflows" | "Skills"): CompletionItem[] => instructions
    .filter((i) => i.kind === kind && i.name.toLowerCase().includes(s))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(s)) - Number(!b.name.toLowerCase().startsWith(s)) || a.name.localeCompare(b.name))
    .map((i) => ({ kind, label: i.name, detail: describe(i), insert: i.name, group }));
  return [...rows("workflow", "Workflows"), ...rows("skill", "Skills")].slice(0, max);
}
