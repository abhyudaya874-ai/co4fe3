import { describe, it, expect } from "vitest";
import { truncateWithHint } from "../src/util/truncate.js";

it("returns the same text when under the limit", () => {
  const t = "short";
  expect(truncateWithHint(t, 10, "hint")).toBe(t);
});

it("cuts on a line boundary and the note names the right number of characters", () => {
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i} of some length here\n`);
  const text = lines.join("");
  const out = truncateWithHint(text, 100, "Call read_file with offset.");
  expect(out.length).toBeLessThanOrEqual(100 + 80);   // kept part + the note
  expect(out).toContain("truncated:");
  expect(out).toContain("Call read_file with offset.");
  const kept = out.slice(0, out.indexOf("\n…(truncated:"));
  expect(text.startsWith(kept)).toBe(true);
  expect(text[kept.length]).toBe("\n");   // kept ends just before a line boundary; the note starts on its own line
  const more = Number(/truncated: (\d+) more characters/.exec(out)?.[1]);
  expect(kept.length + more).toBe(text.length);
});
