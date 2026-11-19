import { describe, it, expect } from "vitest";
import { withinBudget, type Timer } from "../src/context/budget.js";

/** A manual clock. `at(ms, v)` resolves at now+ms; `tick` advances the clock running due jobs in time order. */
const fakeTimer = () => {
  type Job = { at: number; fn: () => void };
  const q: Job[] = [];
  let now = 0;
  const timer: Timer = {
    set: (fn, ms) => { const t = { at: now + ms, fn }; q.push(t); return t; },
    clear: (t) => { const i = q.indexOf(t as never); if (i >= 0) q.splice(i, 1); },
  };
  const at = <T,>(ms: number, v: T): Promise<T> => new Promise((res) => { q.push({ at: now + ms, fn: () => res(v) }); });
  const tick = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = q.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      q.splice(q.indexOf(due), 1);
      due.fn();
      for (let i = 0; i < 10; i++) await Promise.resolve();    // let promise chains settle between jobs
    }
    now = end;
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  /** Ticks in small steps until `p` resolves (or ~5000 fake ms pass). */
  const settle = async <T,>(p: Promise<T>): Promise<T> => {
    const box: { v: T | null } = { v: null };
    void p.then((v) => { box.v = v; });
    for (let i = 0; i < 100 && box.v === null; i++) await tick(50);
    if (box.v === null) throw new Error("the promise never settled");
    return box.v;
  };
  return { timer, at, tick, settle };
};

describe("withinBudget", () => {
  it("full in time → 'full', quick never runs", async () => {
    const { timer, at, settle } = fakeTimer();
    let quickRan = false;
    const r = await settle(withinBudget(() => at(100, "F"), () => { quickRan = true; return at(10, "Q"); }, "N", { fullMs: 800, quickMs: 200, timer }));
    expect(r).toEqual({ value: "F", path: "full" });
    expect(quickRan).toBe(false);
  });

  it("full late → quick", async () => {
    const { timer, at, settle } = fakeTimer();
    const r = await settle(withinBudget(() => at(900, "F"), () => at(50, "Q"), "N", { fullMs: 800, quickMs: 200, timer }));
    expect(r).toEqual({ value: "Q", path: "quick" });
  });

  it("both late → 'none' with the fallback", async () => {
    const { timer, at, settle } = fakeTimer();
    const r = await settle(withinBudget(() => at(900, "F"), () => at(300, "Q"), "N", { fullMs: 800, quickMs: 200, timer }));
    expect(r).toEqual({ value: "N", path: "none" });
  });

  it("full throws → quick", async () => {
    const { timer, at, settle } = fakeTimer();
    const r = await settle(withinBudget(async () => { throw new Error("index dead"); }, () => at(10, "Q"), "N", { fullMs: 800, quickMs: 200, timer }));
    expect(r).toEqual({ value: "Q", path: "quick" });
  });
});
