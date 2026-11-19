import type { PanelEvent } from "./events.js";
import { rowId } from "./reducer.js";

/** Keeps the LAST snapshot per row id and the FIRST-SEEN order, so a batch never renders stale text. */
export function coalesce(batch: readonly PanelEvent[]): PanelEvent[] {
  const last = new Map<string, PanelEvent>();
  const order: string[] = [];
  for (const e of batch) {
    const id = rowId(e);
    if (!last.has(id)) order.push(id);
    last.set(id, e);
  }
  return order.map((id) => last.get(id)!);
}
