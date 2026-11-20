import { describe, it, expect } from "vitest";
import { resolveModelOrder, modelRows, providerOf, shortName } from "../src/forge/models.js";
import { emptyStat, type ModelStat } from "../src/latency/stats.js";

// TrueForge lists models alphabetically, which put Gemini (63 s once to first token) ahead of nemotron.
const SERVED = ["google-gemini/gemini-flash-lite", "nvidia-nim/nemotron-super", "nvidia-nim/nemotron-ultra"];
const DEFAULT = ["nvidia-nim/nemotron-super", "google-gemini/gemini-flash-lite"];

describe("resolveModelOrder", () => {
  it("the default pair wins over TrueForge's alphabetical list: nemotron first, Gemini as the fallback", () => {
    expect(resolveModelOrder({ pick: null, configured: DEFAULT, explicit: false, served: SERVED })).toEqual(["nvidia-nim/nemotron-super", "google-gemini/gemini-flash-lite", "nvidia-nim/nemotron-ultra"]);
  });
  it("an order the user set is respected exactly: nothing is added behind it", () => {
    expect(resolveModelOrder({ pick: null, configured: ["google-gemini/gemini-flash-lite"], explicit: true, served: SERVED })).toEqual(["google-gemini/gemini-flash-lite"]);
  });
  it("a model picked in the chat goes first; the rest keep their order and a fallback from another provider is added", () => {
    const o = resolveModelOrder({ pick: "google-gemini/gemini-flash-lite", configured: DEFAULT, explicit: false, served: SERVED });
    expect(o[0]).toBe("google-gemini/gemini-flash-lite");
    expect(o).toContain("nvidia-nim/nemotron-super");
    expect(new Set(o).size).toBe(o.length);
  });
  it("a pick on top of an explicit order still has a fallback behind it", () => {
    const o = resolveModelOrder({ pick: "nvidia-nim/nemotron-ultra", configured: ["nvidia-nim/nemotron-super"], explicit: true, served: SERVED });
    expect(o).toEqual(["nvidia-nim/nemotron-ultra", "nvidia-nim/nemotron-super", "google-gemini/gemini-flash-lite"]);
  });
  it("default names TrueForge does not serve are skipped; when none are served, what is served is used", () => {
    expect(resolveModelOrder({ pick: null, configured: ["openai/gpt-x", "nvidia-nim/nemotron-super"], explicit: false, served: SERVED })[0]).toBe("nvidia-nim/nemotron-super");
    expect(resolveModelOrder({ pick: null, configured: ["openai/gpt-x", "nvidia-nim/nemotron-super"], explicit: false, served: SERVED })).not.toContain("openai/gpt-x");
    expect(resolveModelOrder({ pick: null, configured: ["openai/gpt-x"], explicit: false, served: SERVED })[0]).toBe("google-gemini/gemini-flash-lite");
  });
  it("an explicit order is not checked against a served list that may be stale (a provider registered a moment ago)", () => {
    expect(resolveModelOrder({ pick: null, configured: ["fake-e2e-1/scripted"], explicit: true, served: SERVED })).toEqual(["fake-e2e-1/scripted"]);
  });
  it("before TrueForge answers, the configured names are used as they are", () => {
    expect(resolveModelOrder({ pick: null, configured: DEFAULT, explicit: false, served: [] })).toEqual(DEFAULT);
    expect(resolveModelOrder({ pick: "x/y", configured: DEFAULT, explicit: false, served: [] })).toEqual(["x/y", ...DEFAULT]);
  });
  it("a pick TrueForge does not serve is ignored", () => {
    expect(resolveModelOrder({ pick: "ghost/model", configured: DEFAULT, explicit: true, served: SERVED })[0]).toBe("nvidia-nim/nemotron-super");
  });
  it("at most three models", () => {
    expect(resolveModelOrder({ pick: null, configured: DEFAULT, explicit: false, served: [...SERVED, "a/b", "c/d"] })).toHaveLength(3);
  });
});

describe("modelRows", () => {
  const now = 1_000_000;
  const stat = (fqn: string, over: Partial<ModelStat>): ModelStat => ({ ...emptyStat(fqn), ...over });
  it("reports p50 only from three samples, the bench time left, and the context length", () => {
    const rows = modelRows(
      [{ name: "nvidia-nim/nemotron-super", contextLength: 131072 }, { name: "google-gemini/gemini-flash-lite" }, { name: "nvidia-nim/nemotron-ultra" }],
      { "nvidia-nim/nemotron-super": stat("nvidia-nim/nemotron-super", { ttft: [700, 900, 800], ok: 3, fail: 1 }), "nvidia-nim/nemotron-ultra": stat("nvidia-nim/nemotron-ultra", { ttft: [500], ok: 1, benchedUntil: now + 150_000, lastError: "403" }) },
      now, ["nvidia-nim/nemotron-super"],
    );
    expect(rows[0]).toMatchObject({ short: "nemotron-super", provider: "nvidia-nim", p50Ms: 800, ok: 3, failed: 1, benchedMin: null, contextLength: 131072, recent: true });
    expect(rows[1]).toMatchObject({ p50Ms: null, ok: 0, contextLength: null, recent: false });
    expect(rows[2]).toMatchObject({ p50Ms: null, benchedMin: 3 });
  });
  it("helpers", () => {
    expect(providerOf("a/b/c")).toBe("a"); expect(providerOf("plain")).toBe(""); expect(shortName("a/b/c")).toBe("c");
  });
});
