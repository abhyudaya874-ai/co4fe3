import { describe, it, expect } from "vitest";
import { record, emptyStat, orderModels, percentile, hedgeDelayMs, stallMs } from "../src/latency/stats.js";

describe("model stats (rule 60)", () => {
  it("record keeps the last 20 TTFT samples and counts", () => {
    let s = emptyStat("p/m");
    for (let i = 0; i < 25; i++) s = record(s, { ok: true, ttftMs: i }, 1000);
    expect(s.ok).toBe(25);
    expect(s.ttft.length).toBe(20);
    expect(s.ttft[0]).toBe(5);
  });

  it("a failure benches for benchMs and keeps the error", () => {
    const s = record(emptyStat("p/m"), { ok: false, benchMs: 60_000, error: "invalid key" }, 10_000);
    expect(s.benchedUntil).toBe(70_000);
    expect(s.lastError).toBe("invalid key");
    expect(s.fail).toBe(1);
  });

  it("orderModels drops benched models, keeps user order, tries anyway when all benched", () => {
    const stats = { "p/a": record(emptyStat("p/a"), { ok: false, benchMs: 60_000, error: "x" }, 0) };
    expect(orderModels(["p/a", "p/b"], stats, 1000, false)).toEqual(["p/b"]);
    expect(orderModels(["p/a"], stats, 1000, false)).toEqual(["p/a"]);   // all benched → try anyway
  });

  it("byLatency sorts healthy models with ≥3 samples by p50", () => {
    let a = emptyStat("p/a"), b = emptyStat("p/b"), c = emptyStat("p/c");
    for (const t of [500, 600, 700]) a = record(a, { ok: true, ttftMs: t }, 0);
    for (const t of [100, 200, 300]) b = record(b, { ok: true, ttftMs: t }, 0);
    const out = orderModels(["p/a", "p/b", "p/c"], { "p/a": a, "p/b": b, "p/c": c }, 0, true);
    expect(out).toEqual(["p/b", "p/a", "p/c"]);   // p/c has no samples → last
  });

  it("stallMs and hedgeDelayMs clamp until sampled", () => {
    expect(stallMs(undefined)).toBe(12_000);
    expect(hedgeDelayMs(undefined)).toBe(4800);   // 1.2× the 4000 default p90
    const fast = { ...emptyStat("p/m"), ttft: [100, 200, 300] };
    expect(stallMs(fast)).toBe(8_000);            // 2·p90 clamped at the 8 s floor
    expect(hedgeDelayMs(fast)).toBe(2_500);       // 1.2·p90 clamped at the 2.5 s floor
  });

  it("percentile picks the nearest-rank element", () => {
    expect(percentile([10, 20, 30], 50)).toBe(20);
    expect(percentile([10, 20, 30], 90)).toBe(30);
    expect(percentile([], 50)).toBeNull();
  });
});
