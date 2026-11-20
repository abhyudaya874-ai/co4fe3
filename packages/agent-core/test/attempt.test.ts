import { describe, it, expect } from "vitest";
import type { TrueForge } from "@truefoundry/trueforge-sdk";
import { attemptTurn } from "../src/forge/attempt.js";
import { allow } from "../src/forge/turn.js";
import type { TfEvent } from "../src/forge/turn.js";

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((r) => { const t = setTimeout(r, ms); signal?.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); });

let n = 0;
const ev = (partial: Record<string, unknown>): TfEvent => ({ id: `e${++n}`, createdAt: new Date().toISOString(), ...partial }) as TfEvent;
const created = (): TfEvent => ev({ type: "turn.created", turnId: "t1", previousTurnId: null });
const msg = (content: string, toolCalls: unknown[] = []): TfEvent => ev({ type: "model.message", threadId: "main", content, toolCalls });
const approval = (sourceEventId: string, id = "call_1"): TfEvent[] => [
  ev({ type: "tool.approval_required", threadId: "main", toolCalls: [{ id, sourceEventId }] }),
  ev({ type: "turn.update", threadId: "main", state: { status: "paused" } }),
];
const done = (): TfEvent => ev({ type: "turn.done", threadId: "main", state: { status: "done", output: { content: "answer" } } });

/** A TrueForge-shaped fake: `script` yields the stream events; `hangAt` parks on the abort signal after that index. */
function fakeClient(script: TfEvent[], o: { hangAt?: number; resume?: TfEvent[] } = {}): { client: TrueForge; posted: unknown[] } {
  const posted: unknown[] = [];
  const park = (abort: AbortSignal): Promise<void> => new Promise<void>((r) => abort.addEventListener("abort", () => r(), { once: true }));
  const stream = async function* (events: TfEvent[], abort: AbortSignal, hangAt?: number) {
    for (const [i, e] of events.entries()) {
      if (hangAt !== undefined && i === hangAt) await park(abort);
      yield e;
    }
    if (hangAt !== undefined && hangAt >= events.length) await park(abort);   // park after the last event
  };
  const client = {
    sessions: {
      createTurnStream: async (_id: string, _body: unknown, opts: { abortSignal: AbortSignal }) => stream(script, opts.abortSignal, o.hangAt),
      subscribeToTurn: async (_id: string, _tid: string, _from: unknown, opts: { abortSignal: AbortSignal }) => {
        if (opts.abortSignal.aborted) throw new Error("aborted");
        return stream(o.resume ?? [done()], opts.abortSignal);
      },
      createTurnEvents: async (_id: string, _tid: string, body: unknown) => { posted.push(body); return {}; },
      cancel: async () => ({}),
    },
  } as unknown as TrueForge;
  return { client, posted };
}

const ui = { onText: () => undefined, onStatus: () => undefined };

describe("attemptTurn watchdogs (workflow 08)", () => {
  it("no events at all → stall at stallMs", async () => {
    const { client } = fakeClient([created()], { hangAt: 1 });
    const r = await attemptTurn({ client, sessionId: "s", text: "x", stallMs: 40, model: "m" }, ui, new AbortController().signal);
    expect(r.outcome.status).toBe("cancelled");
    expect((r.outcome as { reason?: string }).reason).toBe("stall");
    expect(r.firstTokenMs).toBeNull();
  });

  it("a first token then silence → stall at idleMs, firstTokenMs recorded", async () => {
    const { client } = fakeClient([created(), msg("Hello"), ...approval("unused"), done()], { hangAt: 2 });
    const r = await attemptTurn({ client, sessionId: "s", text: "x", stallMs: 500, idleMs: 40, model: "m" }, ui, new AbortController().signal);
    expect(r.outcome.status).toBe("cancelled");
    expect((r.outcome as { reason?: string }).reason).toBe("stall");
    expect(r.firstTokenMs).not.toBeNull();
  });

  it("a pause lasting 5× idleMs (user reviewing) → no stall", async () => {
    const call = { id: "call_1", type: "function", function: { name: "noop", arguments: "{}" }, toolInfo: { type: "mcp", name: "noop", serverId: "s", serverName: "x" } };
    const m = msg("", [call]);
    const { client } = fakeClient([created(), m, ...approval(m.id), done()]);
    const r = await attemptTurn({ client, sessionId: "s", text: "x", stallMs: 2000, idleMs: 30, model: "m" }, {
      ...ui,
      onPause: async (pending) => { await sleep(160); return pending.map((p) => allow(p)); },
    }, new AbortController().signal);
    expect(r.outcome.status).toBe("done");
    expect(r.sideEffects).toBe(true);              // an allow was answered → no silent fallback
  });

  it("a steady stream → done, no stall", async () => {
    const { client } = fakeClient([created(), msg("part "), msg("part part"), done()]);
    const r = await attemptTurn({ client, sessionId: "s", text: "x", stallMs: 500, idleMs: 500, model: "m" }, ui, new AbortController().signal);
    expect(r.outcome.status).toBe("done");
    expect(r.firstTokenMs).not.toBeNull();
  });
});
