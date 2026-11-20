import { describe, it, expect } from "vitest";
import { it as itProp } from "@fast-check/vitest";
import * as fc from "fast-check";
import { indexFile, buildIndex, rankFiles } from "../src/context/repomap.js";
import { assemblePack, renderPack, outlineOf } from "../src/context/pack.js";

const file = (path: string, nSyms: number) =>
  indexFile(path, Array.from({ length: nSyms }, (_, i) => `def sym_${path.replace(/\W/g, "_")}_${i}(x):\n    return x\n`).join("\n"));

describe("assemblePack", () => {
  const ix = buildIndex([file("a.py", 4), file("b.py", 2), file("c/c.py", 6)]);

  itProp.prop([fc.integer({ min: 0, max: 60_000 }), fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 0, maxLength: 20 })])(
    "used <= budget and used === Σ items.tokens for any index and any budget",
    (budget, symCounts) => {
      const ix2 = buildIndex(symCounts.map((n, i) => file(`f${i}.py`, n)));
      const p = assemblePack(ix2, rankFiles(ix2, { text: "sym return", mentioned: [], recent: [] }), [], budget);
      expect(p.used).toBeLessThanOrEqual(budget);
      expect(p.used).toBe(p.items.reduce((a, i) => a + i.tokens, 0));
    },
  );

  it("pins come first and full mode beats outline until the budget runs out", () => {
    const ranked = rankFiles(ix, { text: "sym", mentioned: [], recent: [] });
    const p = assemblePack(ix, ranked, [{ kind: "file", path: "a.py" }], 100_000);
    expect(p.items[0]!.path).toBe("a.py");
    expect(p.items[0]!.pinned).toBe(true);
    expect(p.items[0]!.mode).toBe("full");
    expect(p.items[0]!.why).toContain("mentioned by you");
  });

  it("a pin that does not fit degrades to an outline, not a crash", () => {
    const p = assemblePack(ix, [], [{ kind: "file", path: "c/c.py" }], 60);
    expect(p.items.length).toBeLessThanOrEqual(1);
    if (p.items.length) expect(p.items[0]!.mode).toBe("outline");
  });

  it("over-budget ranked files land in skipped", () => {
    const ranked = rankFiles(ix, { text: "sym", mentioned: [], recent: [] });
    const p = assemblePack(ix, ranked, [], 50);
    expect(p.skipped.every((s) => s.why === "over budget")).toBe(true);
  });

  it("a symbol pin produces a slice of its lines", () => {
    const p = assemblePack(ix, [], [{ kind: "symbol", name: "sym_a_py_0", path: "a.py", line: 1 }], 100_000);
    expect(p.items[0]!.mode).toBe("slice");
    expect(p.items[0]!.text).toContain("def sym_a_py_0");
  });

  it("a pin for an unindexed path is skipped", () => {
    const p = assemblePack(ix, [], [{ kind: "file", path: "nope.py" }], 100_000);
    expect(p.items).toHaveLength(0);
  });
});

describe("renderPack / outlineOf", () => {
  it("the empty pack renders nothing", () => {
    expect(renderPack({ items: [], used: 0, budget: 0, skipped: [], path: "none" })).toBe("");
  });

  it("the pack is marked as a map, not the files", () => {
    const ix = buildIndex([file("a.py", 3)]);
    const p = { ...assemblePack(ix, rankFiles(ix, { text: "sym", mentioned: [], recent: [] }), [], 6000), path: "full" as const };
    const out = renderPack(p);
    expect(out).toContain("<context_pack");
    expect(out).toContain("not the files");
  });

  it("outlineOf indents methods under their parent and caps at 40", () => {
    const f = indexFile("m.py", "class C:\n    def m(self):\n        pass\ndef top():\n    pass\n" + Array.from({ length: 45 }, (_, i) => `def f${i}():\n    pass`).join("\n"));
    const out = outlineOf(f);
    expect(out).toContain("    def m(self):");
    expect(out).toContain("more symbols");
  });
});

describe("wantsPack: small talk gets no repo map", () => {
  it("greetings, thanks and one-word follow-ups get none; a code request, a mention or a selection gets one", async () => {
    const { wantsPack } = await import("../src/context/pack.js");
    for (const t of ["hi", "Hi!", "hiii", "hello", "thanks", "thank you!", "ok", "yes", "yes, go ahead", "go ahead please", "do it", "continue", "how are you?", "  "]) expect(wantsPack(t), t).toBe(false);
    for (const t of ["add a comment to View", "why does dispatch_request fail", "hi, fix the redirect bug", "look at @app.py", "yes"]) expect(wantsPack(t, t === "yes"), t).toBe(true);
  });
});
