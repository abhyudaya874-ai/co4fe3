import type { TfEvent, EventIndex } from "./turn.js";
import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { messageText, toolNameOf, briefOf } from "./events.js";
import { textOf } from "./turn.js";
import { parseProfile, type Mode } from "../runtime/modes.js";
import type { MemberStatus } from "../crew/evidence.js";
import type { PanelEvent } from "../panel/events.js";

/** The tool call with this id, found inside the model.message that issued it (newest message first). */
export function findToolCall(index: EventIndex, toolCallId: string): TrueForgeApi.ToolCall | undefined {
  const events = [...index.values()];
  for (let i = events.length - 1; i >= 0; i--) {
    const m = events[i] as { type?: string; toolCalls?: TrueForgeApi.ToolCall[] };
    if (m.type !== "model.message") continue;
    const hit = m.toolCalls?.find((c) => c.id === toolCallId);
    if (hit) return hit;
  }
  return undefined;
}

/** Maps one TrueForge event to PanelEvents. Pure; the webview never sees SDK types. */
export function fromForge(e: TfEvent, index: EventIndex, ctx: { mode: Mode; serverName?: string }): PanelEvent[] {
  switch (e.type) {
    case "model.message":
    case "model.message.delta": {                                 // deltas merge into the base in the index; emit the row on every event
      const base = index.get(e.id) as { reasoningContent?: unknown; toolCalls?: TrueForgeApi.ToolCall[] } | undefined;
      const out: PanelEvent[] = [{ kind: "text", id: e.id, threadId: e.threadId, text: messageText(index, e.id), reasoning: String(base?.reasoningContent ?? "") }];
      for (const c of base?.toolCalls ?? []) {
        if (toolNameOf(c, ctx.serverName ?? "") === null && c.toolInfo?.type !== "truefoundry-system") continue;
        out.push({ kind: "tool", id: c.id, threadId: e.threadId, name: c.toolInfo?.name ?? "?", args: String(c.function?.arguments ?? ""), state: "running" });
      }
      return out;
    }
    case "tool.response": {
      const call = findToolCall(index, e.toolCallId);          // the index is keyed by EVENT id; the call lives inside a model.message
      return [{ kind: "tool", id: e.toolCallId, threadId: e.threadId, name: call?.toolInfo?.name ?? call?.function?.name ?? "tool", args: String(call?.function?.arguments ?? ""), state: "ok", result: textOf(e.content) }];
    }
    case "thread.created": {
      const brief = briefOf(e);                                   // forge/events.ts
      return [
        { kind: "member", threadId: e.threadId, title: e.title, profile: parseProfile(brief, ctx.mode), status: "running" },
        { kind: "message", id: `to-${e.threadId}`, from: "main", to: e.title, text: brief },
      ];
    }
    case "thread.done": {
      const status: MemberStatus = e.state.status === "done" ? "completed" : "failed";
      return [
        { kind: "member", threadId: e.threadId, title: e.title, status },   // the reducer MERGES member rows
        { kind: "message", id: `from-${e.threadId}`, from: e.title ?? e.threadId, to: "main", text: textOf(e.state.output?.content) || (e.state.status === "error" ? String(e.state.error ?? "") : "") },
      ];
    }
    case "thread.context_compaction_started":
      return [{ kind: "marker", id: `compact-${e.threadId}`, text: "context compacted" }];
    case "turn.update":
      return [{ kind: "status", state: e.state.status === "paused" ? "paused" : "running" }];
    case "turn.done": {
      const s = e.state;
      if (s.status === "done") return [{ kind: "status", state: "done" }];
      if (s.status === "cancelled") return [{ kind: "status", state: "cancelled", message: s.reason }];
      return [{ kind: "status", state: "error", message: s.message }];
    }
    default:
      return [];
  }
}
