import type { PanelEvent } from "./events.js";
import type { BoardEntry } from "../crew/board.js";

export interface PanelState { order: Row[]; byId: Record<string, Row>; status: Extract<PanelEvent, { kind: "status" }> | null; board: BoardEntry[] }
export type Row = { k: PanelEvent["kind"]; id: string; e: PanelEvent };

export const emptyPanel = (): PanelState => ({ order: [], byId: {}, status: null, board: [] });

export function rowId(e: PanelEvent): string {
  switch (e.kind) {
    case "user": return `user:${e.turnId}`;
    case "text": return `text:${e.id}`;
    case "tool": return `tool:${e.id}`;
    case "member": return `member:${e.threadId}`;
    case "message": return `message:${e.id}`;
    case "pack": return "pack";
    case "instructions": return "instructions";
    case "proposal": return `proposal:${e.key}`;
    case "command": return `command:${e.id}`;
    case "board": return "board";
    case "marker": return `marker:${e.id}`;
    case "model": return `model:${JSON.stringify(e.note)}`;
    case "latency": return `latency:${e.line}`;
    case "status": return "status";
  }
}

/** Same (kind,id) → replace in place; new → append. Never mutates `s`. Replaying a batch twice gives the same state. */
export function applyPanelEvent(s: PanelState, e: PanelEvent): PanelState {
  if (e.kind === "status") return { ...s, status: e };
  if (e.kind === "board") return { ...s, board: e.entries };
  const id = rowId(e);                                     // e.g. "tool:<id>", "proposal:<key>", "member:<threadId>"
  const prev = s.byId[id];
  const merged = prev && e.kind === "member" ? ({ ...prev.e, ...e } as PanelEvent) : e;   // member rows merge (keep role/title); all else replaces
  const row: Row = { k: e.kind, id, e: merged };
  return prev ? { ...s, byId: { ...s.byId, [id]: row } } : { ...s, order: [...s.order, row], byId: { ...s.byId, [id]: row } };
}
