import { describe, it, expect } from "vitest";
import { classifyFailure, retryAfterMs, runWithFallback, type AttemptResult, type Note } from "../src/forge/fallback.js";
import type { TurnOutcome } from "../src/forge/turn.js";

const done = (out = "ok"): AttemptResult => ({ outcome: { status: "done", turnId: "t1", output: out }, sideEffects: false, firstTokenMs: 120 });
const err = (message: string, sideEffects = false): AttemptResult => ({ outcome: { status: "error", turnId: undefined, previousTurnId: null, message, sawOutput: false }, sideEffects, firstTokenMs: null });
const stall = (): AttemptResult => ({ outcome: { status: "cancelled", turnId: undefined, reason: "stall" }, sideEffects: false, firstTokenMs: null });
const notes = (): Note[] & { push(n: Note): void } => { const a: Note[] = [] as Note[] & { push(n: Note): void }; return a; };
const sleep = async (): Promise<void> => undefined;

describe("classifyFailure (rule 70; strings recorded in spike row 5)", () => {
  it.each([
    ["HTTP 403: Forbidden", "auth"],
    ["The model request failed: 401 Unauthorized", "auth"],
    ["invalid api key for provider nvidia-nim", "auth"],
    ["Cannot connect to API: bad port", "unreachable"],
    ["fetch failed", "unreachable"],
    ["HTTP 429: rate limit exceeded, retry in 41.2s", "rate"],
    ["quota exceeded for gemini-flash-lite", "rate"],
    ["HTTP 500: internal server error", "server"],
    ["model gemini-9 does not exist", "not_found"],
    ["request timed out", "stall"],
    ["context length exceeded (128000 > 131072)", "context"],
    ["something weird happened", "unknown"],
  ])("%s → %s", (m, kind) => expect(classifyFailure(m).kind).toBe(kind));

  it("retryAfterMs parses 'retry in 41.2s' and caps at 1 h", () => {
    expect(retryAfterMs("retry in 41.2s")).toBe(41_700);
    expect(retryAfterMs("Retry-After: 30s")).toBe(30_500);
    expect(retryAfterMs("nothing")).toBeNull();
    expect(retryAfterMs("retry in 99999s")).toBe(3_600_000);
  });
});

describe("runWithFallback (rule 70 state machine)", () => {
  it("a 401 moves to the next model with no same-model retry", async () => {
    const seen: string[] = [], ns = notes();
    const r = await runWithFallback(["a", "b"], async (m) => { seen.push(m); return m === "a" ? err("HTTP 403: Forbidden") : done(); }, (n) => ns.push(n), new AbortController().signal, sleep);
    expect(seen).toEqual(["a", "b"]);
    expect(r.model).toBe("b");
    expect(ns.map((n) => n.kind)).toEqual(["attempt", "failed", "attempt", "answered"]);
  });

  it("a 500 retries the same model once, then moves on", async () => {
    const seen: string[] = [];
    const r = await runWithFallback(["a", "b"], async (m) => { seen.push(m); return m === "a" ? err("HTTP 500: internal server error") : done(); }, () => undefined, new AbortController().signal, sleep);
    expect(seen).toEqual(["a", "a", "b"]);
    expect(r.model).toBe("b");
  });

  it("a stall moves on with no same-model retry", async () => {
    const seen: string[] = [];
    const r = await runWithFallback(["a", "b"], async (m) => { seen.push(m); return m === "a" ? stall() : done(); }, () => undefined, new AbortController().signal, sleep);
    expect(seen).toEqual(["a", "b"]);
    expect(r.model).toBe("b");
  });

  it("a failure after a side effect stops: no retry, no fallback", async () => {
    const seen: string[] = [], ns = notes();
    const r = await runWithFallback(["a", "b"], async (m) => { seen.push(m); return err("HTTP 500", true); }, (n) => ns.push(n), new AbortController().signal, sleep);
    expect(seen).toEqual(["a"]);
    expect(r.model).toBeNull();
    expect(ns.at(-1)?.kind).toBe("failed");
    expect((ns.at(-1) as { next?: string }).next).toBeNull();
  });

  it("all fail → failures in order", async () => {
    const r = await runWithFallback(["a", "b"], async () => err("HTTP 403"), () => undefined, new AbortController().signal, sleep);
    expect(r.model).toBeNull();
    if (r.model === null) expect(r.failures.map((f: { model: string }) => f.model)).toEqual(["a", "b"]);
  });

  it("Stop: no fallback, no answered note", async () => {
    const ac = new AbortController(); ac.abort();
    const ns = notes();
    const r = await runWithFallback(["a", "b"], async (m) => { ns.push({ kind: "answered", model: m, fellBack: false }); return done(); }, (n) => ns.push(n), ac.signal, sleep);
    expect(r.model).toBeNull();
    expect(ns.some((n) => n.kind === "answered")).toBe(false);
  });

  it("Stop mid-turn returns that attempt's cancelled outcome (no 'failed' note)", async () => {
    const ac = new AbortController();
    const ns = notes();
    const r = await runWithFallback(["a", "b"], async () => { ac.abort(); return { outcome: { status: "cancelled", turnId: undefined, reason: "client-cancelled" }, sideEffects: false, firstTokenMs: null }; }, (n) => ns.push(n), ac.signal, sleep);
    expect(r.model).toBe("a");
    if (r.model) expect((r.result.outcome as TurnOutcome).status).toBe("cancelled");
    expect(ns.some((n) => n.kind === "failed")).toBe(false);
  });
});
