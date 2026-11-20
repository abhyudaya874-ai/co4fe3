import type { PanelEvent } from "./events.js";
import type { BoardEntry } from "../crew/board.js";

export interface PanelState { order: Row[]; byId: Record<string, Row>; status: Extract<PanelEvent, { kind: "status" }> | null; board: BoardEntry[]; usage: Extract<PanelEvent, { kind: "usage" }> | null }
export type Row = { k: PanelEvent["kind"]; id: string; e: PanelEvent };

export const emptyPanel = (): PanelState => ({ order: [], byId: {}, status: null, board: [], usage: null });

export const proposalRowId = (key: string): string => `proposal:${key}`;
export const planRowId = (id: string): string => `plan:${id}`;

export function rowId(e: PanelEvent): string {
  switch (e.kind) {
    case "user": return `user:${e.turnId}`;
    case "text": return `text:${e.id}`;
    case "tool": return `tool:${e.id}`;
    case "member": return `member:${e.threadId}`;
    case "message": return `message:${e.id}`;
    case "pack": return `pack:${e.turnId ?? ""}`;
    case "instructions": return `instructions:${e.turnId ?? ""}`;
    case "proposal": return proposalRowId(e.key);
    case "command": return `command:${e.id}`;
    case "board": return "board";
    case "plan": return planRowId(e.id);
    case "marker": return `marker:${e.id}`;
    case "model": return `model:${e.turnId ?? ""}:${JSON.stringify(e.note)}`;
    case "latency": return `latency:${e.line}`;
    case "status": return "status";
    case "usage": return "usage";
  }
}

/** Same (kind,id) → replace in place; new → append. Never mutates `s`. Replaying a batch twice gives the same state. */
export function applyPanelEvent(s: PanelState, e: PanelEvent): PanelState {
  if (e.kind === "status") return { ...s, status: e };
  if (e.kind === "board") return { ...s, board: e.entries };
  if (e.kind === "usage") return { ...s, usage: e };                       // the context meter: only the latest call counts
  const id = rowId(e);                                     // e.g. "tool:<id>", "proposal:<key>", "member:<threadId>"
  const prev = s.byId[id];
  const merged = prev && e.kind === "member" ? ({ ...prev.e, ...e } as PanelEvent)                // member rows merge (keep role/title)
    : prev?.e.kind === "command" && e.kind === "command" ? ({ ...e, command: e.command || prev.e.command } as PanelEvent)   // a command card keeps its text when a later update lacks it
    : e;                                                                                         // all else replaces
  const row: Row = { k: e.kind, id, e: merged };
  if (!prev) return { ...s, order: [...s.order, row], byId: { ...s.byId, [id]: row } };
  const at = s.order.findIndex((r) => r.id === id);                     // the webview renders from order: replace the row there too
  const order = at >= 0 ? [...s.order.slice(0, at), row, ...s.order.slice(at + 1)] : [...s.order, row];
  return { ...s, order, byId: { ...s.byId, [id]: row } };
}

/** The events that rebuild `s` from nothing: rows in order, then the status and the board. Replaying them is the snapshot. */
export function panelEvents(s: PanelState): PanelEvent[] {
  return [...s.order.map((r) => r.e), ...(s.status ? [s.status] : []), ...(s.board.length ? [{ kind: "board" as const, entries: s.board }] : []), ...(s.usage ? [s.usage] : [])];
}

/** One reducer pass for a whole bridge batch (rule 60 lever 10): the webview dispatches the batch once. */
export function applyPanelBatch(s: PanelState, events: readonly PanelEvent[]): PanelState {
  return events.reduce(applyPanelEvent, s);
}
