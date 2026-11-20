import { createElement as h, memo } from "react";
import type { PanelEvent, PanelState } from "@co4fe3/agent-core/panel";
import { UserBubble, TextRow, Thoughts, ToolCard, MemberRow, MessageBubble, PackCard, BoardCard, DiffCard, CommandCard, ModelBanner, Marker } from "./rows.js";

/** The transcript, in order. Rows are memo'd; a newer snapshot replaces its row in place. */
export const Transcript = memo(function Transcript({ s, onDecide, onOpen, onVerdict }: {
  s: PanelState;
  onDecide(key: string, hunkId: string, v: "accepted" | "rejected"): void;
  onOpen(key: string): void;
  onVerdict(id: string, v: "allow" | "deny"): void;
}) {
  return h("div", { className: "transcript" }, s.order.map((row) => {
    const e = row.e;
    switch (e.kind) {
      case "user": return h(UserBubble, { key: row.id, e });
      case "text": return h("div", { key: row.id }, h(TextRow, { e, streaming: s.status?.state === "running" }), h(Thoughts, { e }));
      case "tool": return h(ToolCard, { key: row.id, e });
      case "member": return h(MemberRow, { key: row.id, e });
      case "message": return h(MessageBubble, { key: row.id, e });
      case "pack": return h(PackCard, { key: row.id, e });
      case "proposal": return h(DiffCard, { key: row.id, e, onDecide, onOpen });
      case "command": return h(CommandCard, { key: row.id, e, onVerdict });
      case "marker": return h(Marker, { key: row.id, e });
      case "board": return h(BoardCard, { key: row.id, entries: e.entries });
      case "model": return h(ModelBanner, { key: row.id, e });
      case "latency": return h("div", { key: row.id, className: "row marker latency" }, e.line);
      case "instructions": return null;   // renders in the header
      default: return null;
    }
  }));
});
