import type { TfEvent, EventIndex } from "./turn.js";
import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";

/** The merged text of a model.message event (string or parts; verified in the spike). */
export function messageText(index: EventIndex, id: string): string {
  const m = index.get(id);
  const c = (m as { content?: unknown } | undefined)?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p && typeof p === "object" && "text" in p && typeof p.text === "string" ? p.text : "")).join("");
  return "";
}

/** The bare tool name for our preloaded server (`toolInfo.type === "mcp"`); null for anything else. */
export function toolNameOf(call: TrueForgeApi.ToolCall | undefined, serverName: string): string | null {
  const info = call?.toolInfo;
  if (!info || info.type !== "mcp") return null;
  return info.serverName === serverName ? info.name : null;
}

export function safeJson(s: string | undefined): unknown {
  if (!s) return undefined;
  try { return JSON.parse(s); } catch { return undefined; }
}

/** The brief a lead sent to a member: `thread.created.agentInfo.input` (verified: a string). */
export function briefOf(e: Extract<TfEvent, { type: "thread.created" }>): string {
  return e.agentInfo?.input ?? "";
}
