import { describe, it, expect } from "vitest";
import { indexFile, buildIndex, rankFiles } from "../../src/context/repomap.js";
import { assemblePack, renderPack } from "../../src/context/pack.js";
import { shapeSymbolPack, type SymbolFacts } from "../../src/context/symbolPack.js";

/** A generated 400-file repo: modules define symbols, later files use them, so the graph has real edges. */
const genFile = (i: number): { path: string; text: string } => {
  const dep = i > 0 ? `from pkg.mod${(i - 1) % 50} import helper_${(i - 1) % 50}\n` : "";
  const uses = i > 0 ? `    helper_${(i - 1) % 50}(x)\n    value = CONSTANT_${i % 20}\n` : "";
  return {
    path: `pkg/mod${i % 50}/file${i}.py`,
    text: dep + `CONSTANT_${i % 20} = ${i}\n\ndef func_${i}(x):\n    """Handle request ${i} for the service."""\n${uses}    return x\n\nclass Widget${i}:\n    def render_${i}(self):\n        return None\n`,
  };
};

const FILES = Array.from({ length: 400 }, (_, i) => genFile(i));
const median = (xs: number[]): number => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

describe("context perf (2× the rule-60 budgets)", () => {
  it("indexes a 400-file repo under 3 s", () => {
    const t = performance.now();
    const ix = buildIndex(FILES.map((f) => indexFile(f.path, f.text)));
    const ms = performance.now() - t;
    console.log(`perf index.build ${Math.round(ms)}ms files=${ix.files.length}`);
    expect(ms).toBeLessThan(3000);
    expect(ix.files).toHaveLength(400);
  });

  it("rankFiles with all four channels under 100 ms; assemblePack under 160 ms", () => {
    const ix = buildIndex(FILES.map((f) => indexFile(f.path, f.text)));
    const grepHits = new Map(FILES.slice(0, 30).map((f, i) => [f.path, 10 - Math.floor(i / 4)]));
    const q = { text: "add a command that renders the request handler widget", mentioned: ["pkg/mod0/file0.py"], active: "pkg/mod1/file51.py", recent: ["pkg/mod2/file102.py"], grepHits };
    const rankedMs: number[] = [], packMs: number[] = [];
    for (let i = 0; i < 15; i++) {
      let t = performance.now();
      const ranked = rankFiles(ix, q);
      rankedMs.push(performance.now() - t);
      t = performance.now();
      const p = assemblePack(ix, ranked, [], 6000);
      renderPack({ ...p, path: "full" });
      packMs.push(performance.now() - t);
    }
    console.log(`perf rankFiles median=${median(rankedMs).toFixed(1)}ms assemblePack median=${median(packMs).toFixed(1)}ms`);
    expect(median(rankedMs)).toBeLessThan(100);
    expect(median(packMs)).toBeLessThan(160);
  });

  it("shapeSymbolPack under 20 ms", () => {
    const facts: SymbolFacts = {
      symbol: { name: "render", path: "pkg/w.py", line: 1, endLine: 40 },
      definition: "def render(self):\n" + "    return None\n".repeat(40), signature: "render()", problems: [],
      callers: Array.from({ length: 10 }, (_, i) => ({ from: `c${i}`, path: "a.py", line: i, snippet: ["x\n".repeat(8)] })),
      references: Array.from({ length: 8 }, (_, i) => ({ path: "b.py", line: i, snippet: ["y\n".repeat(5)] })),
      source: "lsp",
    };
    const ms: number[] = [];
    for (let i = 0; i < 20; i++) { const t = performance.now(); shapeSymbolPack(facts, "refactor", 3000); ms.push(performance.now() - t); }
    console.log(`perf shapeSymbolPack median=${median(ms).toFixed(1)}ms`);
    expect(median(ms)).toBeLessThan(20);
  });
});
