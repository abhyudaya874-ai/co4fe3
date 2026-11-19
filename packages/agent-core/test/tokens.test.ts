import { describe, it, expect } from "vitest";
import { estimateTokens } from "../src/context/tokens.js";

it("code (punct-heavy) costs fewer tokens per char than prose", () => {
  const code = "def f(x):\n    return x[0] + 1  # (a) {b}\n";
  const prose = "this is a plain english sentence with no punctuation at all ";
  expect(estimateTokens(code)).toBeLessThan(estimateTokens(prose) * (code.length / prose.length) + 5);
});

it("scales about linearly and never returns 0 for non-empty input", () => {
  expect(estimateTokens("")).toBe(0);
  expect(estimateTokens("word ")).toBeGreaterThan(0);
  expect(estimateTokens("word ".repeat(100))).toBeGreaterThan(90);
});

it("non-ASCII costs about 0.7 token per char", () => {
  expect(estimateTokens("é".repeat(10))).toBe(7);
});
