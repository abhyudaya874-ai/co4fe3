import { describe, it, expect } from "vitest";
import { applyPanelEvent, emptyPanel, type PanelEvent } from "../../src/panel/index.js";
import { toHunks } from "../../src/review/hunks.js";
import { rrfMerge } from "../../src/context/rrf.js";
import { withinBudget, type Timer } from "../../src/context/budget.js";

const median = (xs: number[]): number => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

describe("latency perf (2× the rule-60 budgets)", () => {
  it("folds 10,000 panel events in < 400 ms", () => {
    const events = Array.from({ length: 10_000 }, (_, i): PanelEvent => ({ kind: "text", id: `m${i % 50}`, threadId: "main", text: "x".repeat(i % 300), reasoning: "" }));
    const t = performance.now();
    events.reduce(applyPanelEvent, emptyPanel());
    const ms = performance.now() - t;
    console.log(`perf panel-fold 10k ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(400);
  });

  it("toHunks on a 5,000-line file in < 40 ms", () => {
    const before = Array.from({ length: 5000 }, (_, i) => `line ${i} unchanged`).join("\n");
    const after = before.split("\n").map((l, i) => (i % 100 === 50 ? `${l} CHANGED` : l)).join("\n");
    const ms: number[] = [];
    for (let i = 0; i < 15; i++) { const t = performance.now(); toHunks(before, after); ms.push(performance.now() - t); }
    console.log(`perf toHunks 5k median=${median(ms).toFixed(1)}ms`);
    expect(median(ms)).toBeLessThan(40);
  });

  it("rrfMerge over 4 × 60 ids in < 2 ms", () => {
    const channels = Array.from({ length: 4 }, (_, c) => Array.from({ length: 60 }, (_, i) => `f${(i + c * 17) % 90}`));
    const ms: number[] = [];
    for (let i = 0; i < 50; i++) { const t = performance.now(); rrfMerge(channels, 60); ms.push(performance.now() - t); }
    console.log(`perf rrfMerge median=${median(ms).toFixed(2)}ms`);
    expect(median(ms)).toBeLessThan(2);
  });

  it("withinBudget starts the quick path exactly at fullMs", async () => {
    const calls: string[] = [];
    const jobs: [() => void, number][] = [];
    const timer: Timer = { set: (fn, ms) => { jobs.push([fn, ms]); return fn; }, clear: () => undefined };
    const r = withinBudget(async () => { calls.push("full"); await new Promise((r2) => setTimeout(r2, 30)); return "full"; }, async () => { calls.push("quick"); return "quick"; }, "none", { fullMs: 800, quickMs: 200, timer });
    jobs.find(([, ms]) => ms === 800)?.[0]();                 // fire the full-budget boundary
    const out = await r;
    expect(calls).toContain("quick");
    expect(out.path).toBe("quick");
  });
});
