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
  selection: SelectionRef | null;
  busy: boolean;                       // a turn is running
  sessionUrl: string | null;           // this conversation's page in TrueForge, once it has a session
}
export const emptyChrome = (): ChromeState => ({ model: "", mode: "code", folder: "", trueforge: "starting", layout: "editor", selection: null, busy: false, sessionUrl: null });

export interface SessionSummary { id: string; title: string; updatedAt: number; running: boolean }

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
  | { type: "completions"; kind: "@" | "/"; items: string[] };

/** A stored session: the transcript, plus the TrueForge session to continue it with. */
export interface PersistedSession {
  v: 1;
  id: string; title: string; createdAt: number; updatedAt: number;
  forge?: ForgeRef;
  events: PanelEvent[];
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
    case "ready": case "stop": case "focus": case "openSession": case "pickModel": case "models": case "newSession":
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
    case "setMode": return UI_MODES.some((m) => m.id === o.mode) ? { type: "setMode", mode: o.mode as UiMode } : null;
    case "complete": { const prefix = str("prefix"); return (o.kind === "@" || o.kind === "/") && prefix !== null && prefix.length < 200 ? { type: "complete", kind: o.kind, prefix } : null; }
    case "setModel": return o.name === null ? { type: "setModel", name: null } : typeof o.name === "string" && o.name.length < 200 ? { type: "setModel", name: o.name } : null;
    case "switchSession": { const id = str("id"); return id ? { type: "switchSession", id } : null; }
    case "deleteSession": { const id = str("id"); return id ? { type: "deleteSession", id } : null; }
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
