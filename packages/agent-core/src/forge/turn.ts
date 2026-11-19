import { TrueForge, TrueForgeApi, isEventDelta, mergeEventDelta } from "@truefoundry/trueforge-sdk";
import { STREAM } from "./client.js";

export type TfEvent = TrueForgeApi.TurnStreamingEvent;
export type EventIndex = Map<string, TfEvent>;
export interface PendingCall { threadId: string; toolCallId: string; kind: "approval" | "response"; call: TrueForgeApi.ToolCall | undefined }
export interface TurnHooks {
  /** Every event, after it is merged into `index`. Synchronous, never throws (wrap your own code in try/catch). */
  onEvent(e: TfEvent, index: EventIndex): void;
  /** The turn paused. Resolve with one answer per pending call. The user may take minutes. Reject when `signal` aborts. */
  onPause(pending: PendingCall[], index: EventIndex, signal: AbortSignal): Promise<TrueForgeApi.TurnUserEventMessage[]>;
}
export type TurnOutcome =
  | { status: "done"; turnId: string; output: string }
  | { status: "cancelled"; turnId?: string; reason: string }
  | { status: "error"; turnId?: string; previousTurnId: string | null; message: string; sawOutput: boolean };

export async function runTurn(i: { client: TrueForge; sessionId: string; text: string; previousTurnId?: string; signal: AbortSignal; hooks: TurnHooks }): Promise<TurnOutcome> {
  const index: EventIndex = new Map();
  let turnId: string | undefined;
  let prev: string | null = null;
  let lastEventId: string | undefined;
  let sawOutput = false;
  const stop = () => void i.client.sessions.cancel(i.sessionId, undefined, { timeoutInSeconds: 10, maxRetries: 0 }).catch(() => undefined);
  if (i.signal.aborted) return { status: "cancelled", reason: "client-cancelled" };
  i.signal.addEventListener("abort", stop, { once: true });
  const opts = { ...STREAM, abortSignal: i.signal };      // Stop ends the read at once, even if the server is slow
  try {
    let stream = await i.client.sessions.createTurnStream(i.sessionId, { input: [{ type: "user.message", content: i.text }], previousTurnId: i.previousTurnId ?? "auto" }, opts);
    for (;;) {
      const pending: PendingCall[] = [];
      let paused = false;
      for await (const e of stream) {
        lastEventId = e.id;
        if (isEventDelta(e)) { const base = index.get(e.id); if (base) mergeEventDelta(base, e); sawOutput = true; }
        else index.set(e.id, e);                            // a replayed event replaces the old copy: idempotent
        if (e.type === "turn.created") { turnId = e.turnId; prev = e.previousTurnId ?? null; }
        if (e.type === "tool.approval_required" || e.type === "tool.response_required")
          for (const ref of e.toolCalls) pending.push({ threadId: e.threadId, toolCallId: ref.id, kind: e.type === "tool.approval_required" ? "approval" : "response", call: findCall(index, ref.sourceEventId, ref.id) });
        try { i.hooks.onEvent(e, index); } catch { /* a UI bug must never kill the turn */ }
        if (e.type === "turn.update" && e.state.status === "paused") { paused = true; break; }
        if (e.type === "turn.done") return outcomeOf(e, turnId, prev, sawOutput);
      }
      if (!turnId) return { status: "error", previousTurnId: prev, message: "stream ended before turn.created", sawOutput };
      if (!paused) { stream = await i.client.sessions.subscribeToTurn(i.sessionId, turnId, { fromEventId: lastEventId }, opts); continue; } // dropped: resume
      const answers = await i.hooks.onPause(pending, index, i.signal);          // per-hunk review happens in here
      const resume = await i.client.sessions.subscribeToTurn(i.sessionId, turnId, { afterEventId: lastEventId }, opts); // subscribe FIRST
      await i.client.sessions.createTurnEvents(i.sessionId, turnId, { events: answers }, { timeoutInSeconds: 15, maxRetries: 0 });
      stream = resume;
    }
  } catch (err) {
    if (i.signal.aborted) return { status: "cancelled", turnId, reason: "client-cancelled" };
    return { status: "error", turnId, previousTurnId: prev, message: err instanceof Error ? err.message : String(err), sawOutput };
  } finally {
    i.signal.removeEventListener("abort", stop);
  }
}

export function findCall(index: EventIndex, sourceEventId: string, id: string): TrueForgeApi.ToolCall | undefined {
  const m = index.get(sourceEventId);
  return m?.type === "model.message" ? m.toolCalls?.find((c) => c.id === id) : undefined;
}

function outcomeOf(e: Extract<TfEvent, { type: "turn.done" }>, turnId: string | undefined, prev: string | null, sawOutput: boolean): TurnOutcome {
  const s = e.state;
  if (s.status === "done") return { status: "done", turnId: turnId ?? "", output: textOf(s.output?.content) };
  if (s.status === "cancelled") return { status: "cancelled", turnId, reason: s.reason };
  return { status: "error", turnId, previousTurnId: prev, message: s.message, sawOutput };
}

/** `content` is a string or an array of parts. VERIFY the part shape in ModelMessageEventContent.d.ts on first use. */
export function textOf(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p && typeof p === "object" && "text" in p && typeof p.text === "string" ? p.text : "")).join("");
  return "";
}

export const allow = (p: PendingCall): TrueForgeApi.TurnUserEventMessage => ({ type: "user.tool_approval", threadId: p.threadId, toolCallId: p.toolCallId, approval: { status: "allow" } });
export const deny = (p: PendingCall, reason: string): TrueForgeApi.TurnUserEventMessage => ({ type: "user.tool_approval", threadId: p.threadId, toolCallId: p.toolCallId, approval: { status: "deny", reason } });
export const reply = (p: PendingCall, content: string): TrueForgeApi.TurnUserEventMessage => ({ type: "user.tool_response", threadId: p.threadId, toolCallId: p.toolCallId, content });
