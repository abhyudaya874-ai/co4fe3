import type { TrueForge, TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { runTurn, textOf, deny, type TurnHooks, type TfEvent, type EventIndex, type TurnOutcome } from "./turn.js";
import { IDLE_STALL_MS } from "../latency/stats.js";
import type { AttemptResult } from "./fallback.js";

/** The UI surface an inline attempt reports into (rule 60: the UI follows one leader). */
export interface AttemptUi {
  onText(full: string, threadId: string): void;
  onStatus(s: string): void;
  onEvent?(e: TfEvent, index: EventIndex): void;
  onPause?: TurnHooks["onPause"];
}

/**
 * runTurn + two watchdogs (V3Code's stream watchdog, rule 60 lever 13):
 *  - first token: none within `stallMs` → stall;
 *  - idle: after the first token, no event at all for `idleMs` → stall. Reset on EVERY event; paused while a review waits for the user.
 * A stall aborts the attempt and returns { cancelled, reason: "stall" } so the router can fall back.
 */
export async function attemptTurn(a: { client: TrueForge; sessionId: string; text: string; previousTurnId?: string; stallMs: number; idleMs?: number; model: string }, ui: AttemptUi, signal: AbortSignal, now = () => performance.now()): Promise<AttemptResult> {
  const ac = new AbortController();
  const onOuter = (): void => ac.abort();
  signal.addEventListener("abort", onOuter, { once: true });
  const t0 = now();
  let first: number | null = null, stalled = false, sideEffects = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const stallNow = (): void => { stalled = true; ac.abort(); };
  const armIdle = (): void => { clearTimeout(idle); idle = setTimeout(stallNow, a.idleMs ?? IDLE_STALL_MS); };
  const firstToken = setTimeout(() => { if (first === null) stallNow(); }, a.stallMs);
  const tick = setInterval(() => { if (first === null) ui.onStatus(`Waiting for ${a.model}… ${Math.round((now() - t0) / 1000)} s`); }, 1000);
  try {
    const outcome: TurnOutcome = await runTurn({ client: a.client, sessionId: a.sessionId, text: a.text, previousTurnId: a.previousTurnId, signal: ac.signal, hooks: {
      onEvent: (e, index) => {
        if (first !== null) armIdle();                                  // any event proves the stream is alive
        if (e.type === "model.message" || e.type === "model.message.delta") {
          const m = index.get(e.id);
          const t = m?.type === "model.message" ? textOf(m.content) : "";
          if (t || (m?.type === "model.message" && m.toolCalls?.length)) {
            if (first === null) { first = now() - t0; clearTimeout(firstToken); armIdle(); }
            if (t) ui.onText(t, m!.type === "model.message" ? m.threadId : "main");
          }
        }
        ui.onEvent?.(e, index);
      },
      onPause: async (pending, index, s) => {
        clearTimeout(idle);                                              // a person reading a diff is not a stall
        try {
          const answers: TrueForgeApi.TurnUserEventMessage[] = ui.onPause ? await ui.onPause(pending, index, s) : pending.map((p) => deny(p, "This mode has no tools."));
          if (answers.some((x) => x.type === "user.tool_approval" && x.approval.status === "allow")) sideEffects = true;
          return answers;
        } finally { if (first !== null) armIdle(); }
      },
    } });
    return { outcome: stalled ? { status: "cancelled", turnId: undefined, reason: "stall" } : outcome, sideEffects, firstTokenMs: first };
  } finally { clearTimeout(firstToken); clearTimeout(idle); clearInterval(tick); signal.removeEventListener("abort", onOuter); }
}
