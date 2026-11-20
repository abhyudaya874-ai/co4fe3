import { describe, it, expect } from "vitest";
import { hedged, collectFailures, AttemptFailed, type Attempt } from "../src/latency/hedge.js";
import type { Timer } from "../src/context/budget.js";

/** A timer whose set() queues jobs; tick() fires the ones due. */
const fakeTimer = (): Timer & { tick(): void } => {
  const jobs: (() => void)[] = [];
  return { set: (fn) => { jobs.push(fn); return fn; }, clear: (t) => { const i = jobs.indexOf(t as () => void); if (i >= 0) jobs.splice(i, 1); }, tick: () => { for (const j of jobs.splice(0)) j(); } };
};
const attempt = (name: string, o: { streamAt?: number; hang?: boolean; fail?: boolean; failAfter?: boolean; value?: string }): { a: Attempt<string>; saw: () => number } => {
  const state = { calls: 0 };
  return { saw: () => state.calls, a: async (signal, onFirst) => {
    state.calls++;
    if (o.hang) await new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true }));   // never streams
    else if (o.streamAt !== undefined) await new Promise<void>((r) => { const t = setTimeout(r, o.streamAt); signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); });
    if (signal.aborted) throw new Error(`${name} aborted`);
    if (o.fail) throw new AttemptFailed(name, { kind: "auth", benchMs: 0, retrySame: false, detail: "401" });   // fails BEFORE streaming
    onFirst();
    if (o.failAfter) throw new AttemptFailed(name, { kind: "server", benchMs: 0, retrySame: false, detail: "500" });   // fails AFTER winning the lead
    return o.value ?? name;
  } };
};

describe("hedged (rule 60 lever 9)", () => {
  it("a streams before the delay → b never starts", async () => {
    const timer = fakeTimer();
    const A = attempt("a", { streamAt: 0 });
    const B = attempt("b", { streamAt: 0 });
    const r = await hedged(A.a, B.a, 50, new AbortController().signal, timer);
    expect(r).toEqual({ winner: "a", value: "a" });
    expect(B.saw()).toBe(0);
  });

  it("a is silent → b starts at the delay, streams first, a is aborted", async () => {
    const timer = fakeTimer();
    const A = attempt("a", { hang: true });                        // never streams, never fails
    const B = attempt("b", { streamAt: 0 });
    const p = hedged(A.a, B.a, 50, new AbortController().signal, timer);
    timer.tick();                                                  // the delay fires → b starts
    expect(await p).toEqual({ winner: "b", value: "b" });
    expect(B.saw()).toBe(1);
  });

  it("a fails early → b starts at once", async () => {
    const timer = fakeTimer();
    const A = attempt("a", { streamAt: 0, fail: true });
    const B = attempt("b", { streamAt: 0 });
    expect(await hedged(A.a, B.a, 50, new AbortController().signal, timer)).toEqual({ winner: "b", value: "b" });
  });

  it("both fail → rejects with the last error", async () => {
    const timer = fakeTimer();
    const A = attempt("a", { streamAt: 0, fail: true });
    const B = attempt("b", { streamAt: 0, fail: true });
    await expect(hedged(A.a, B.a, 50, new AbortController().signal, timer)).rejects.toBeInstanceOf(AttemptFailed);
  });

  it("the leader fails after winning → rejects (does not hang)", async () => {
    const timer = fakeTimer();
    const A = attempt("a", { streamAt: 0, failAfter: true });
    const B = attempt("b", { hang: true });
    await expect(hedged(A.a, B.a, 50, new AbortController().signal, timer)).rejects.toBeInstanceOf(AttemptFailed);
  });

  it("outer abort aborts both and never resolves", async () => {
    const timer = fakeTimer();
    const outer = new AbortController();
    const A = attempt("a", { streamAt: 10_000 });
    const p = hedged(A.a, null, 50, outer.signal, timer);
    outer.abort();
    const race = await Promise.race([p.then(() => "resolved").catch(() => "rejected"), new Promise((r) => setTimeout(() => r("pending"), 30))]);
    expect(race).toBe("rejected");
  });

  it("collectFailures unwraps an AggregateError", () => {
    const f = (m: string) => new AttemptFailed(m, { kind: "auth", benchMs: 0, retrySame: false, detail: "x" });
    expect(collectFailures(new AggregateError([f("a"), f("b")])).map((x) => x.model)).toEqual(["a", "b"]);
    expect(collectFailures(f("a"))[0]!.model).toBe("a");
  });
});
