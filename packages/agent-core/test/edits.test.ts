import { describe, it, expect } from "vitest";
import { planEdit, MAX_EDIT_CHARS, type EditOp } from "../src/review/edits.js";

const FILE = "alpha\nbeta\ngamma\nalpha\n";

describe("planEdit (rule 30)", () => {
  it("no-file: tells the model to use content instead", () => {
    const p = planEdit(null, [{ oldString: "x", newString: "y" }]);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error).toContain("`content` instead of `edits`");
  });

  it("empty old_string", () => {
    const p = planEdit(FILE, [{ oldString: "", newString: "y" }]);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reasons).toEqual([{ op: 0, reason: "empty" }]);
  });

  it("not-found, with the nearest-line hint", () => {
    const p = planEdit(FILE, [{ oldString: "delta", newString: "y" }]);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error).toContain("was not found");
  });

  it("not-unique names the matching lines", () => {
    const p = planEdit(FILE, [{ oldString: "alpha", newString: "y" }]);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error).toContain("several places (lines 1, 4)");
  });

  it("unchanged: old_string equal to new_string", () => {
    const p = planEdit(FILE, [{ oldString: "beta", newString: "beta" }]);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reasons[0]?.reason).toBe("unchanged");
  });

  it("too-large", () => {
    const big = "x".repeat(MAX_EDIT_CHARS + 1);
    const p = planEdit(FILE, [{ oldString: big, newString: "y" }]);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reasons[0]?.reason).toBe("too-large");
  });

  it("overlap: two edits touching the same span", () => {
    const p = planEdit(FILE, [
      { oldString: "alpha\nbeta", newString: "A" },
      { oldString: "beta\ngamma", newString: "B" },
    ]);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reasons).toContainEqual({ op: 1, reason: "overlap" });
  });

  it("noop: edits that change nothing", () => {
    const p = planEdit("alpha\n", [{ oldString: "alpha", newString: "alpha" }]);
    expect(p.ok).toBe(false);   // caught by `unchanged` first
    const q = planEdit("alpha\n", []);
    expect(q.ok).toBe(false);
    if (!q.ok) expect(q.reasons[0]?.reason).toBe("noop");
  });

  it("two bad ops are reported in one result", () => {
    const p = planEdit(FILE, [{ oldString: "", newString: "y" }, { oldString: "missing", newString: "z" }]);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reasons).toEqual([{ op: 0, reason: "empty" }, { op: 1, reason: "not-found" }]);
  });

  it("a CRLF file with an LF old_string still matches once", () => {
    const crlf = "alpha\r\nbeta\r\ngamma\r\n";
    const p = planEdit(crlf, [{ oldString: "beta\ngamma", newString: "B\ngamma" }]);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.after).toBe("alpha\r\nB\r\ngamma\r\n");
  });

  it("ops are applied against the original text, not earlier ops' output", () => {
    const p = planEdit(FILE, [
      { oldString: "alpha\nbeta", newString: "ALPHA" },
      { oldString: "gamma\nalpha", newString: "GAMMA" },
    ]);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.after).toBe("ALPHA\nGAMMA\n");
  });

  it("create-with-content replaces the whole file", () => {
    const p = planEdit(null, [], "new content");
    expect(p).toEqual({ ok: true, after: "new content" });
  });

  it("a good edit produces the expected text", () => {
    const ops: EditOp[] = [{ oldString: "beta", newString: "BETA" }];
    const p = planEdit(FILE, ops);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.after).toBe("alpha\nBETA\ngamma\nalpha\n");
  });
});
