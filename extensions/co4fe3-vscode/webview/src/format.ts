import type { HunkView, ModelRow, PanelEvent } from "@co4fe3/agent-core/panel";

export type IconName =
  | "plus" | "slash" | "chevronDown" | "chevronRight" | "check" | "x" | "arrowUp" | "arrowDown" | "stop" | "file" | "terminal" | "search"
  | "edit" | "sparkle" | "shield" | "clock" | "expand" | "collapse" | "trash" | "alert" | "link" | "folder" | "brain" | "tool" | "users" | "undo" | "layers" | "book" | "bolt"
  | "pin" | "filter" | "sort" | "archive" | "panelLeft" | "dots" | "group";

const parse = (args: string): Record<string, unknown> => {
  try { const v: unknown = JSON.parse(args); return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; }
  catch { return {}; }
};
const str = (a: Record<string, unknown>, k: string): string => (typeof a[k] === "string" ? (a[k] as string) : "");

/** "co4fe3-ws-ab12cd34" is not a name a person wants to read; the tool names are the bare ones. */
export const bareToolName = (name: string): string => name.split(/[./]/).at(-1) ?? name;

/** The one-line summary of a tool call: a verb, what it acted on, an icon. Arguments may be partial JSON while streaming. */
export function toolLabel(name: string, args: string): { verb: string; target: string; icon: IconName } {
  const n = bareToolName(name), a = parse(args);
  switch (n) {
    case "read_file": {
      const off = typeof a.offset === "number" ? a.offset : 0, lim = typeof a.limit === "number" ? a.limit : 0;
      return { verb: "Read", target: `${str(a, "path")}${off > 1 && lim ? `:${off}-${off + lim - 1}` : off > 1 ? `:${off}` : ""}`, icon: "file" };
    }
    case "search_workspace": return { verb: "Search", target: str(a, "pattern"), icon: "search" };
    case "find_symbol": return { verb: "Find symbol", target: str(a, "name"), icon: "search" };
    case "repo_map": return { verb: "Map the repo", target: str(a, "query"), icon: "layers" };
    case "pack_context": return { verb: "Context for", target: [str(a, "symbol"), str(a, "path")].filter(Boolean).join(" in "), icon: "layers" };
    case "list_changes": return { verb: "List changes", target: "", icon: "clock" };
    case "board_read": return { verb: "Read the board", target: str(a, "key"), icon: "users" };
    case "board_write": return { verb: "Note on the board", target: str(a, "key"), icon: "users" };
    case "load_instructions": {                                          // the agent pulled a skill, rule or file in on its own
      const kind = str(a, "kind"), name = str(a, "name");
      return kind === "skill" ? { verb: "Used skill", target: name, icon: "bolt" }
        : kind === "rule" ? { verb: "Read rule", target: name, icon: "book" }
        : { verb: "Read instructions", target: name, icon: "book" };
    }
    case "use_skill": return { verb: "Used skill", target: str(a, "name"), icon: "bolt" };   // a skill that matched this request (a panel row, not an MCP tool)
    case "propose_edit": return { verb: "Edit", target: str(a, "path"), icon: "edit" };
    case "run_command": return { verb: "Command", target: str(a, "command"), icon: "terminal" };
    case "create_sub_agent": return { verb: "Start a subagent", target: str(a, "name") || str(a, "title"), icon: "users" };
    default: return { verb: n.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase()), target: "", icon: "tool" };
  }
}

/** Tools whose own card shows the work (the command card, the diff card). Their tool row is a quiet one-liner or hidden. */
export const hasOwnCard = (name: string): boolean => ["run_command", "write_plan"].includes(bareToolName(name));

/** "src/flask/cli.py" → { dir: "src/flask/", base: "cli.py" } */
export function splitPath(p: string): { dir: string; base: string } {
  const i = p.lastIndexOf("/");
  return i < 0 ? { dir: "", base: p } : { dir: p.slice(0, i + 1), base: p.slice(i + 1) };
}

export interface DiffLine { kind: "ctx" | "del" | "add"; text: string; oldNo?: number; newNo?: number }

/** The lines of one hunk with their numbers. `delta` = lines the earlier hunks of the file added minus removed, so new-file numbers are right. */
export function hunkLines(h: HunkView, delta: number): DiffLine[] {
  const out: DiffLine[] = [];
  const before = h.before ?? [], after = h.after ?? [];
  const start = h.oldStart + 1;                                          // 1-based
  before.forEach((t, i) => out.push({ kind: "ctx", text: t, oldNo: start - before.length + i, newNo: start - before.length + i + delta }));
  h.oldLines.forEach((t, i) => out.push({ kind: "del", text: t, oldNo: start + i }));
  h.newLines.forEach((t, i) => out.push({ kind: "add", text: t, newNo: start + i + delta }));
  const next = start + h.oldLines.length;
  after.forEach((t, i) => out.push({ kind: "ctx", text: t, oldNo: next + i, newNo: next + i + delta + (h.newLines.length - h.oldLines.length) }));
  return out;
}

/** Per hunk, how many lines the hunks before it in the file added or removed (hunks arrive in file order). */
export function hunkDeltas(hunks: readonly HunkView[]): number[] {
  const out: number[] = [];
  let d = 0;
  for (const h of hunks) { out.push(d); d += h.newLines.length - h.oldLines.length; }   // a hunk cut for length (`hidden`) makes later numbers approximate
  return out;
}

/** 0 = unknown, 1 = slow, 2 = ok, 3 = fast, from the median time to first token. */
export function speedBars(p50Ms: number | null): 0 | 1 | 2 | 3 {
  if (p50Ms === null) return 0;
  return p50Ms < 1500 ? 3 : p50Ms < 4000 ? 2 : 1;
}

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
export const tokens = (n: number): string => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

/** Menu sections: fastest measured first, then what answered lately, then everything else. A model appears once, in the first section it earns. */
export function modelSections(rows: readonly ModelRow[], query: string): { id: "fast" | "recent" | "all"; title: string; rows: ModelRow[] }[] {
  const q = query.trim().toLowerCase();
  const match = (r: ModelRow): boolean => !q || r.name.toLowerCase().includes(q);
  const ok = rows.filter(match);
  const fast = ok.filter((r) => r.p50Ms !== null && !r.benchedMin).sort((a, b) => a.p50Ms! - b.p50Ms!).slice(0, 3);
  const recent = ok.filter((r) => r.recent && !fast.includes(r));
  const rest = ok.filter((r) => !fast.includes(r) && !recent.includes(r));
  return [
    { id: "fast" as const, title: "Fastest", rows: fast },
    { id: "recent" as const, title: "Recently used", rows: recent },
    { id: "all" as const, title: "All models", rows: rest },
  ].filter((s) => s.rows.length);
}

/** A markdown link target that names a workspace file: "src/a.py", "./src/a.py#L12", "src/a.py#L12-L20", "src/a.py:12". */
export function fileLink(url: string): { path: string; line?: number } | null {
  const m = /^(?:\.\/)?([^\s#:?]+?)(?:#L(\d+)(?:-L?\d+)?|:(\d+))?$/.exec(url.trim());
  if (!m) return null;
  const ref = fileRef(m[3] ? `${m[1]}:${m[3]}` : m[1]!);
  if (!ref) return null;
  const line = m[2] ? Number(m[2]) : ref.line;
  return line ? { path: ref.path, line } : { path: ref.path };
}

/** Is this inline-code text a workspace file reference worth a link? "src/a.py", "a.py:12", not "x.y" in prose. */
export function fileRef(code: string): { path: string; line?: number } | null {
  const m = /^((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,7})(?::(\d+))?$/.exec(code.trim());
  if (!m) return null;
  const path = m[1]!;
  if (/^\d+\.\d+/.test(path) || /^(?:e\.g|i\.e)\./i.test(path)) return null;
  if (!path.includes("/") && !/\.(?:py|ts|tsx|js|jsx|json|md|toml|ya?ml|rst|txt|cfg|ini|html|css|sh|go|rs|java|c|h|cpp|rb|php)$/i.test(path)) return null;
  return m[2] ? { path, line: Number(m[2]) } : { path };
}

/** The proposals still waiting for a decision, and the totals the review bar shows ("2 files +14 −3"). */
export function pendingReview(events: readonly PanelEvent[]): { keys: string[]; files: number; adds: number; removes: number } {
  const open = events.filter((e): e is Extract<PanelEvent, { kind: "proposal" }> => e.kind === "proposal" && !e.applied && !e.dropped && e.hunks.some((h) => e.verdict[h.id] === "pending"));
  return { keys: open.map((e) => e.key), files: new Set(open.map((e) => e.path)).size, adds: open.reduce((n, e) => n + e.adds, 0), removes: open.reduce((n, e) => n + e.removes, 0) };
}
