import { describe, it, expect } from "vitest";
import { extractFence, streamingPreview, assembleInline, buildInlinePrompt, canAdvance, PhaseBox, type InlinePhase } from "../src/review/inline.js";
import type { Problem } from "../src/host.js";

describe("extractFence", () => {
  it("a partial fence streams its body", () => {
    expect(extractFence("```python\nabc", false)).toEqual({ code: "abc", complete: false });
  });
  it("a complete fence with a language tag", () => {
    expect(extractFence("```python\nabc\n```", true)).toEqual({ code: "abc\n", complete: true });
  });
  it("an empty body is complete once the fence closes", () => {
    expect(extractFence("```\n\n```", true)).toEqual({ code: "\n", complete: true });
  });
  it("no fence at all: the whole text counts once the turn is done", () => {
    expect(extractFence("just text", false)).toBeNull();
    expect(extractFence("just text", true)).toEqual({ code: "just text", complete: true });
  });
});

describe("streamingPreview + assembleInline", () => {
  const original = "one\ntwo\nthree\nfour\n";
  it("finished lines replace the head; the rest is the original", () => {
    expect(streamingPreview(original, "ONE\ntwo\nth")).toBe("ONE\ntwo\nthree\nfour\n");
    expect(streamingPreview(original, "ONE\ntwo\n")).toBe("ONE\ntwo\nthree\nfour\n");
  });
  it("assembles whole lines and keeps the selection's final newline", () => {
    expect(assembleInline(original, 1, 2, "TWO\nTHREE")).toBe("one\nTWO\nTHREE\nfour\n");
  });
  it("CRLF files keep CRLF", () => {
    const crlf = "one\r\ntwo\r\nthree\r\n";
    expect(assembleInline(crlf, 0, 0, "ONE\n")).toBe("ONE\r\ntwo\r\nthree\r\n");
  });
  it("a selection without a final newline stays without one", () => {
    const noNl = "one\ntwo\nthree";
    expect(assembleInline(noNl, 1, 2, "TWO\nTHREE")).toBe("one\nTWO\nTHREE");
  });
});

describe("buildInlinePrompt", () => {
  const text = Array.from({ length: 200 }, (_, i) => `line ${i}\n`).join("");
  const problems: Problem[] = Array.from({ length: 30 }, (_, i) => ({ code: "E", severity: "error" as const, message: `e${i}`, line: 80 + i }));
  it("lays out the tags and the instruction", () => {
    const p = buildInlinePrompt({ path: "f.py", lang: "python", instruction: "make it loud", text: "a\nb\nc\n", start: 1, end: 1, outline: "", problems: [], budget: 3000 });
    expect(p).toContain("File: f.py (python)");
    expect(p).toContain("Instruction: make it loud");
    expect(p).toContain("<selected>b\n</selected>");
    expect(p).toContain("```python");
  });
  it("the budget actually trims, dropping problems before context", () => {
    const tight = buildInlinePrompt({ path: "f.py", lang: "python", instruction: "x", text, start: 100, end: 100, outline: "", problems, budget: 250 });
    expect(tight).not.toContain("<problems>");
    const loose = buildInlinePrompt({ path: "f.py", lang: "python", instruction: "x", text, start: 100, end: 100, outline: "", problems, budget: 6000 });
    expect(loose).toContain("<problems>");
    expect(loose).toContain("<before>");
  });
});

describe("canAdvance / PhaseBox", () => {
  it("forward moves are allowed, backward moves are refused", () => {
    expect(canAdvance("reading", "drafting")).toBe(true);
    expect(canAdvance("drafting", "reading")).toBe(false);
    expect(canAdvance("reviewing", "applied")).toBe(true);
  });
  it("terminal phases are sticky; any live phase may end in cancelled", () => {
    expect(canAdvance("applied", "drafting")).toBe(false);
    expect(canAdvance("error", "applied")).toBe(false);
    expect(canAdvance("drafting", "cancelled")).toBe(true);
    expect(canAdvance("reviewing", "sourceChanged")).toBe(true);
  });
  it("PhaseBox throws on an illegal move and reports changes", () => {
    const seen: InlinePhase[] = [];
    const box = new PhaseBox("reading", (p) => seen.push(p));
    box.to("drafting");
    expect(() => box.to("reading")).toThrow();
    box.to("applied");
    expect(box.phase).toBe("applied");
    expect(seen).toEqual(["drafting", "applied"]);
  });
});
