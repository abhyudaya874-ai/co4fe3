import { describe, it, expect } from "vitest";
import { it as itProp } from "@fast-check/vitest";
import * as fc from "fast-check";
import { shapeSymbolPack, renderSymbolPack, TASK_CAPS, type SymbolFacts } from "../src/context/symbolPack.js";
import { estimateTokens } from "../src/context/tokens.js";

const facts = (o: Partial<SymbolFacts> = {}): SymbolFacts => ({
  symbol: { name: "f", path: "a.py", line: 4, endLine: 9 },
  definition: "def f():\n    return 1\n", signature: "def f() -> int", problems: [],
  callers: [], references: [], source: "lsp",
  ...o,
});

describe("shapeSymbolPack", () => {
  it("applies the per-task caps", () => {
    const callers = Array.from({ length: 20 }, (_, i) => ({ from: `c${i}`, path: "x.py", line: i, snippet: ["s"] }));
    const p = shapeSymbolPack(facts({ callers }), "understand", 100_000);
    expect(p.callers).toHaveLength(TASK_CAPS.understand.callers);
    expect(p.dropped.callers).toBe(20 - TASK_CAPS.understand.callers);
  });

  it("trims references first, then caller snippets, then callers", () => {
    const refs = Array.from({ length: 4 }, (_, i) => ({ path: "r.py", line: i, snippet: ["x\n".repeat(400)] }));
    const callers = Array.from({ length: 3 }, (_, i) => ({ from: `c${i}`, path: "x.py", line: i, snippet: ["x\n".repeat(400)] }));
    const p = shapeSymbolPack(facts({ references: refs, callers }), "understand", 1000);
    expect(p.dropped.references).toBeGreaterThan(0);          // references go first
    expect(p.tokens).toBeLessThanOrEqual(Math.max(500, 1000) + 60);
  });

  it("a huge definition is cut with the note", () => {
    const p = shapeSymbolPack(facts({ definition: "x".repeat(20_000) }), "understand", 3000);
    expect(p.definition).toContain("Definition truncated");
    expect(p.definition.length).toBeLessThanOrEqual(6000 + 100);   // 2 × budget + the note
  });

  itProp.prop([fc.nat({ max: 30 }), fc.nat({ max: 30 })])("the output fits max_tokens for random facts", (nc, nr) => {
    const big = facts({
      callers: Array.from({ length: nc }, (_, i) => ({ from: `c${i}`, path: "x.py", line: i, snippet: ["line of caller code\n".repeat(9)] })),
      references: Array.from({ length: nr }, (_, i) => ({ path: `r${i}.py`, line: i, snippet: ["ref line\n".repeat(9)] })),
    });
    const p = shapeSymbolPack(big, "extend", 800);
    expect(p.tokens).toBeLessThanOrEqual(Math.max(500, 800) + 80);
  });

  it("source passes through", () => {
    expect(shapeSymbolPack(facts({ source: "index" }), "debug", 5000).source).toBe("index");
  });

  it("renderSymbolPack names the source and reports drops", () => {
    const p = shapeSymbolPack(facts({ references: Array.from({ length: 9 }, (_, i) => ({ path: "r.py", line: i, snippet: [] })) }), "understand", 100_000);
    const out = renderSymbolPack(p);
    expect(out).toContain("from lsp");
    expect(out).toContain(`dropped: ${9 - TASK_CAPS.understand.references} references`);
    expect(estimateTokens(out)).toBe(p.tokens);
  });
});
