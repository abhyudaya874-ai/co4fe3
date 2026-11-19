import { describe, expect } from "vitest";
import { it } from "@fast-check/vitest";
import fc from "fast-check";
import { toHunks, applyHunks, previewLines } from "../src/review/hunks.js";

describe("hunks (rule 30)", () => {
  it.prop([fc.string(), fc.string()])("all hunks give `after`, none give `before`", (a, b) => {
    const hs = toHunks(a, b);
    expect(applyHunks(a, hs, new Set(hs.map((h) => h.id)))).toBe(b);
    expect(applyHunks(a, hs, new Set())).toBe(a);
  });

  it("keeps CRLF and a missing final newline byte-for-byte", () => {
    const a = "x\r\ny\r\nz", b = "x\r\nY\r\nz";
    expect(applyHunks(a, toHunks(a, b), new Set(["h1"]))).toBe(b);
  });

  it("a partial take applies only the chosen hunks", () => {
    const a = "one\ntwo\nthree\nfour\nfive\n";
    const b = "ONE\ntwo\nTHREE\nfour\nFIVE\n";
    const hs = toHunks(a, b);
    expect(hs.map((h) => h.id)).toEqual(["h1", "h2", "h3"]);
    expect(applyHunks(a, hs, new Set(["h1", "h3"]))).toBe("ONE\ntwo\nthree\nfour\nFIVE\n");
  });

  it("previewLines places each hunk in the preview text", () => {
    const a = "1\n2\n3\n4\n5\n", b = "1\nX\n3\n4\nY\n";
    const hs = toHunks(a, b);
    const at = previewLines(hs, new Set(hs.map((h) => h.id)));
    expect(at.get("h1")).toBe(1);
    expect(at.get("h2")).toBe(4);
  });
});
