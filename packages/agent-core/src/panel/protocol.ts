import type { PanelEvent, UiCommand } from "./events.js";
import type { Mode } from "../runtime/modes.js";

// The host ↔ webview protocol beyond the transcript: layout, chrome, sessions, the model picker. Pure types and helpers.
// PanelEvents (events.ts) are the transcript; everything here is the frame around it.

/** The two ways to see the agent: the full-window Agent view, or the Editor with the agent docked on the right. */
export type LayoutId = "agent" | "editor";

/** The composer's mode menu. "bypass" is Code with commands auto-approved; edits are always reviewed (law 4). */
export type UiMode = "code" | "ask" | "plan" | "bypass";
export const UI_MODES: readonly { id: UiMode; label: string; hint: string }[] = [
  { id: "code", label: "Code", hint: "Write and edit code" },
  { id: "ask", label: "Ask", hint: "Answer questions without code changes" },
  { id: "plan", label: "Plan", hint: "Plan changes before implementing" },
  { id: "bypass", label: "Bypass Permissions", hint: "Auto-approve commands. Edits are still reviewed" },
];

/** UI mode → the runtime mode and whether run_command skips the Allow/Deny card. */
export function runtimeOf(ui: UiMode): { mode: Mode; autoApproveCommands: boolean } {
  switch (ui) {
    case "code": return { mode: "agent", autoApproveCommands: false };
    case "ask": return { mode: "ask", autoApproveCommands: false };
    case "plan": return { mode: "plan", autoApproveCommands: false };
    case "bypass": return { mode: "agent", autoApproveCommands: true };
  }
}
export function uiModeOf(mode: Mode, autoApproveCommands: boolean): UiMode {
  return mode === "agent" ? (autoApproveCommands ? "bypass" : "code") : mode;
}
/** Ctrl+. cycles through the menu in order. */
export function nextUiMode(ui: UiMode): UiMode {
  const i = UI_MODES.findIndex((m) => m.id === ui);
  return UI_MODES[(i + 1) % UI_MODES.length]!.id;
}

/** The editor selection the composer offers to attach. Lines are 1-based and inclusive. */
export interface SelectionRef { path: string; start: number; end: number }
export const selectionLabel = (s: SelectionRef): string => `${s.path.split("/").at(-1)}#L${s.start}${s.end > s.start ? `-${s.end}` : ""}`;

export type TrueforgeState = "connected" | "waiting" | "down" | "starting";

/** Everything the webview shows that is not a transcript row. Sent whole, then as partial updates. */
export interface ChromeState {
  model: string;                       // the primary model FQN, or "" while none is known
  mode: UiMode;
  folder: string;                      // workspace folder name ("" when none is open)
  trueforge: TrueforgeState;
  layout: LayoutId;                    // which layout the HOST is in; a hosted webview's own shape comes from its mount point
  attached: SelectionRef | null;       // the editor selection the person sent to the chat (Chat, Ctrl+L); merely selecting text never sets it
  busy: boolean;                       // a turn is running
  sessionUrl: string | null;           // this conversation's page in TrueForge, once it has a session
  sidebar: SidebarPrefs;               // the sessions list: width, sort, group, filter
}
export const emptyChrome = (): ChromeState => ({ model: "", mode: "code", folder: "", trueforge: "starting", layout: "editor", attached: null, busy: false, sessionUrl: null, sidebar: defaultSidebar() });

/** What the sessions list shows, and what its search, filter, group and sort work on. It lives in the index, so listing loads nothing. */
export interface SessionSummary {
  id: string; title: string; updatedAt: number; running: boolean;
  createdAt: number;
  pinned: boolean; archived: boolean;
  renamed: boolean;                    // the person named it: the first message no longer retitles it
  model: string;                       // the model that last answered ("" before the first answer)
  turns: number;                       // messages the person sent
  edits: number;                       // changes applied to files
  preview: string;                     // the first message, up to 200 characters (search looks here too)
}

export type SessionSort = "updated" | "created" | "name" | "turns";
export type SessionGroup = "none" | "date" | "model" | "status";
export type SessionFilter = "all" | "pinned" | "running" | "edited" | "archived";
export const SESSION_SORTS: readonly SessionSort[] = ["updated", "created", "name", "turns"];
export const SESSION_GROUPS: readonly SessionGroup[] = ["none", "date", "model", "status"];
export const SESSION_FILTERS: readonly SessionFilter[] = ["all", "pinned", "running", "edited", "archived"];
export const SIDEBAR_MIN = 200, SIDEBAR_MAX = 520, SIDEBAR_DEFAULT = 264;

/** How the sessions sidebar looks and what it shows. Kept per person, so it survives closing the window. */
export interface SidebarPrefs { width: number; hidden: boolean; sort: SessionSort; desc: boolean; group: SessionGroup; filter: SessionFilter; collapsed: string[] }
export const defaultSidebar = (): SidebarPrefs => ({ width: SIDEBAR_DEFAULT, hidden: false, sort: "updated", desc: true, group: "none", filter: "all", collapsed: [] });

/** The valid part of an untrusted object: only known keys with allowed values (numbers clamped). */
export function sidebarPatch(raw: unknown): Partial<SidebarPrefs> {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const o = Object.fromEntries(Object.entries(src));                          // own properties only: a key inherited from a prototype is not input
  const out: Partial<SidebarPrefs> = {};
  if (typeof o.width === "number" && Number.isFinite(o.width)) out.width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(o.width)));
  if (typeof o.hidden === "boolean") out.hidden = o.hidden;
  if (typeof o.desc === "boolean") out.desc = o.desc;
  if (SESSION_SORTS.includes(o.sort as SessionSort)) out.sort = o.sort as SessionSort;
  if (SESSION_GROUPS.includes(o.group as SessionGroup)) out.group = o.group as SessionGroup;
  if (SESSION_FILTERS.includes(o.filter as SessionFilter)) out.filter = o.filter as SessionFilter;
  if (Array.isArray(o.collapsed)) out.collapsed = o.collapsed.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 60).slice(0, 40);
  return out;
}
/** Stored or sent preferences laid over `base`; anything invalid keeps `base`'s value. */
export const normalizeSidebar = (raw: unknown, base: SidebarPrefs = defaultSidebar()): SidebarPrefs => ({ ...base, ...sidebarPatch(raw) });

/** The TrueForge chat session behind a transcript, and what its spec was built from (so an unchanged spec is not re-sent). */
export interface ForgeRef { sessionId: string; model: string; mode: Mode; instr: string }

/** One model in the picker. Stats come from the Router; nothing here is invented. */
export interface ModelRow {
  name: string;                        // FQN "provider/model"
  provider: string;
  short: string;                       // the part after the last "/"
  p50Ms: number | null;                // median time to first token, null under 3 samples
  ok: number; failed: number;
  benchedMin: number | null;           // minutes left when benched
  contextLength: number | null;        // tokens, from TrueForge's model list
  recent: boolean;                     // answered a request in this workspace
}

/** Host → webview. */
export type HostMessage =
  | { type: "events"; batch: PanelEvent[] }
  | { type: "snapshot"; events: PanelEvent[] }                          // replaces the transcript (session switch, first paint)
  | { type: "chrome"; chrome: Partial<ChromeState> }
  | { type: "sessions"; items: SessionSummary[]; activeId: string }
  | { type: "models"; rows: ModelRow[]; current: string; auto: boolean }
  | { type: "focusComposer"; text?: string }                              // the chat was opened for a selection: focus the box, optionally with a draft
  | { type: "completions"; kind: "@" | "/"; prefix: string; items: CompletionItem[] };    // prefix: the token it answers (a late reply for an old token is ignored)

/** One row of the "@" or "/" menu. `insert` is what follows the "@" or "/" in the draft; `group` is the section header. */
export interface CompletionItem {
  kind: "file" | "folder" | "symbol" | "rule" | "skill" | "workflow";
  label: string;                       // what the row shows in bold: a file's base name, a symbol, a rule's name
  detail: string;                      // dimmed after it: the folder, path:line, the description
  insert: string;
  group: "Open files" | "Files & folders" | "Symbols" | "Rules & skills" | "Workflows" | "Skills";
}

/** A stored session: the transcript, plus the TrueForge session to continue it with. */
export interface PersistedSession {
  v: 1;
  id: string; title: string; createdAt: number; updatedAt: number;
  forge?: ForgeRef;
  pinned?: boolean; archived?: boolean; renamed?: boolean;
  model?: string; turns?: number; edits?: number; preview?: string;
  events: PanelEvent[];
}

/** The list entry for a stored session. */
export function summaryOf(s: PersistedSession, running = false): SessionSummary {
  return { id: s.id, title: s.title, updatedAt: s.updatedAt, running, createdAt: s.createdAt, pinned: !!s.pinned, archived: !!s.archived, renamed: !!s.renamed, model: s.model ?? s.forge?.model ?? "", turns: s.turns ?? 0, edits: s.edits ?? 0, preview: s.preview ?? "" };
}

/** An index entry read from disk. Entries written by older builds lack the newer fields: they get defaults. Null when it is not an entry at all. */
export function normalizeSummary(raw: unknown): SessionSummary | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.title !== "string" || typeof o.updatedAt !== "number") return null;
  const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return { id: o.id, title: o.title, updatedAt: o.updatedAt, running: false, createdAt: num(o.createdAt, o.updatedAt), pinned: o.pinned === true, archived: o.archived === true, renamed: o.renamed === true, model: typeof o.model === "string" ? o.model : "", turns: num(o.turns, 0), edits: num(o.edits, 0), preview: typeof o.preview === "string" ? o.preview : "" };
}

/** What the list needs to know about a transcript: messages sent, changes applied, and the first message. */
export function sessionStats(events: readonly PanelEvent[]): { turns: number; edits: number; preview: string } {
  let turns = 0, edits = 0, preview = "";
  for (const e of events) {
    if (e.kind === "user") { turns++; if (!preview) preview = e.text.replace(/\s+/g, " ").trim().slice(0, 200); }
    else if (e.kind === "proposal" && e.applied && !e.applied.undone) edits++;
  }
  return { turns, edits, preview };
}

/** A rename, a pin or an archive. An empty name gives the automatic one back. */
export interface SessionPatch { title?: string; pinned?: boolean; archived?: boolean }
export const cleanTitle = (t: string, max = 100): string => t.replace(/\s+/g, " ").trim().slice(0, max).trimEnd();

export function patchSession<T extends { title: string; renamed?: boolean; pinned?: boolean; archived?: boolean; preview?: string }>(s: T, p: SessionPatch): T {
  const out = { ...s };
  if (p.title !== undefined) {
    const t = cleanTitle(p.title);
    if (t) { out.title = t; out.renamed = true; }
    else { out.renamed = false; out.title = out.preview ? sessionTitle(out.preview) : "New session"; }
  }
  if (p.archived !== undefined) { out.archived = p.archived; if (p.archived) out.pinned = false; }          // archived and pinned exclude each other
  if (p.pinned !== undefined) { out.pinned = p.pinned; if (p.pinned) out.archived = false; }
  return out;
}

/** The first line of the user's first message, trimmed to a list-friendly length. */
export function sessionTitle(text: string, max = 60): string {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const one = line.replace(/\s+/g, " ");
  if (!one) return "New session";
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** "just now", "51 minutes ago", "yesterday". Pure: `now` is passed in. */
export function relativeAge(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (s < 45) return "just now";
  const min = Math.round(s / 60);
  if (min < 60) return plural(Math.max(1, min), "minute");
  const hours = Math.round(s / 3600);
  if (hours < 22) return plural(Math.max(1, hours), "hour");
  const days = Math.round(s / 86_400);
  if (days <= 1) return "yesterday";
  if (days < 30) return plural(days, "day");
  return new Date(then).toISOString().slice(0, 10);
}

const MAX_SEND = 50_000;                                               // characters one message may carry

/** Rebuilds a UiCommand from untrusted `postMessage` data, or null. Unknown types, wrong field types and oversize text are refused. */
export function parseUiCommand(raw: unknown): UiCommand | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (k: string): string | null => (typeof o[k] === "string" ? (o[k] as string) : null);
  const verdict = (): "accepted" | "rejected" | null => (o.verdict === "accepted" || o.verdict === "rejected" ? o.verdict : null);
  switch (o.type) {
    case "ready": case "detach": case "stop": case "focus": case "openSession": case "pickModel": case "models": case "newSession":
      return { type: o.type };
    case "send": {
      const text = str("text");
      if (text === null || !text.trim() || text.length > MAX_SEND) return null;
      const a = o.attach as Record<string, unknown> | undefined;
      const attach = a && typeof a.path === "string" && Number.isInteger(a.start) && Number.isInteger(a.end) ? { path: a.path, start: a.start as number, end: a.end as number } : undefined;
      return attach ? { type: "send", text, attach } : { type: "send", text };
    }
    case "decide": { const key = str("key"), hunkId = str("hunkId"), v = verdict(); return key && hunkId && v ? { type: "decide", key, hunkId, verdict: v } : null; }
    case "decideAll": { const key = str("key"), v = verdict(); return key && v ? { type: "decideAll", key, verdict: v } : null; }
    case "openDiff": { const key = str("key"); return key ? { type: "openDiff", key } : null; }
    case "openFile": { const path = str("path"); return path ? { type: "openFile", path, ...(Number.isInteger(o.line) ? { line: o.line as number } : {}) } : null; }
    case "command": { const id = str("id"); return id && (o.verdict === "allow" || o.verdict === "deny") ? { type: "command", id, verdict: o.verdict } : null; }
    case "undo": { const checkpointId = str("checkpointId"); return checkpointId ? { type: "undo", checkpointId } : null; }
    case "revertTurn": { const turnId = str("turnId"); return turnId ? { type: "revertTurn", turnId } : null; }
    case "plan": { const id = str("id"); return id && (o.verdict === "accept" || o.verdict === "reject") ? { type: "plan", id, verdict: o.verdict } : null; }
    case "openPlan": { const id = str("id"); return id ? { type: "openPlan", id } : null; }
    case "setMode": return UI_MODES.some((m) => m.id === o.mode) ? { type: "setMode", mode: o.mode as UiMode } : null;
    case "complete": { const prefix = str("prefix"); return (o.kind === "@" || o.kind === "/") && prefix !== null && prefix.length < 200 ? { type: "complete", kind: o.kind, prefix } : null; }
    case "setModel": return o.name === null ? { type: "setModel", name: null } : typeof o.name === "string" && o.name.length < 200 ? { type: "setModel", name: o.name } : null;
    case "switchSession": { const id = str("id"); return id ? { type: "switchSession", id } : null; }
    case "deleteSession": { const id = str("id"); return id ? { type: "deleteSession", id } : null; }
    case "renameSession": { const id = str("id"), title = str("title"); return id && title !== null && title.length <= 400 ? { type: "renameSession", id, title } : null; }
    case "pinSession": { const id = str("id"); return id && typeof o.pinned === "boolean" ? { type: "pinSession", id, pinned: o.pinned } : null; }
    case "archiveSession": { const id = str("id"); return id && typeof o.archived === "boolean" ? { type: "archiveSession", id, archived: o.archived } : null; }
    case "setSidebar": return o.prefs && typeof o.prefs === "object" ? { type: "setSidebar", prefs: sidebarPatch(o.prefs) } : null;
    case "setLayout": return o.layout === "agent" || o.layout === "editor" ? { type: "setLayout", layout: o.layout } : null;
    default: return null;
  }
}

const cut = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max)}\n…(+${s.length - max} chars)`);

/** Bounds what a stored transcript can weigh: long tool results and command output are cut. */
export function compactEvents(events: readonly PanelEvent[], maxText = 2000): PanelEvent[] {
  return events.map((e): PanelEvent => {
    if (e.kind === "tool" && e.result !== undefined) return { ...e, result: cut(e.result, maxText), args: cut(e.args, maxText) };
    if (e.kind === "command" && e.output !== undefined) return { ...e, output: cut(e.output, maxText) };
    if (e.kind === "text") return { ...e, text: cut(e.text, 40_000), reasoning: cut(e.reasoning, maxText) };
    if (e.kind === "message") return { ...e, text: cut(e.text, maxText) };
    return e;
  });
}

/** A transcript loaded from disk is history: no run is live, nothing can still be decided. */
export function restoreEvents(events: readonly PanelEvent[]): PanelEvent[] {
  return events.map((e): PanelEvent => {
    if (e.kind === "status" && (e.state === "running" || e.state === "paused" || e.state === "stopping")) return { kind: "status", state: "cancelled", message: "interrupted" };
    if (e.kind === "proposal" && !e.applied && e.hunks.some((h) => e.verdict[h.id] === "pending")) return { ...e, dropped: true };
    if (e.kind === "command" && (e.state === "asking" || e.state === "running")) return { ...e, state: "denied" };
    if (e.kind === "tool" && e.state === "running") return { ...e, state: "error" };
    if (e.kind === "member" && (e.status === "running" || e.status === "waiting-approval")) return { ...e, status: "cancelled" };
    return e;
  });
}
