import { describe, it, expect } from "vitest";
import { newErrors, pickProblems, renderProblem, problemKey, type Problem } from "../src/review/verify.js";

const err = (line: number, message: string): Problem => ({ code: "E", severity: "error", message, line });
const warn = (line: number, message: string): Problem => ({ code: "W", severity: "warning", message, line });

describe("verify (rule 30)", () => {
  it("an edit that moves an old error down 10 lines reports nothing", () => {
    const baseline = [err(3, "undefined name x")];
    const after = [err(13, "undefined name x")];
    expect(newErrors(baseline, after)).toEqual([]);
  });

  it("one new error is reported", () => {
    const baseline = [err(3, "old")];
    const after = [err(3, "old"), err(9, "new mistake")];
    expect(newErrors(baseline, after)).toEqual([err(9, "new mistake")]);
  });

  it("a duplicate of an existing error is reported once when there are two copies", () => {
    const baseline = [err(3, "dup")];
    const after = [err(3, "dup"), err(8, "dup"), err(9, "dup")];
    const fresh = newErrors(baseline, after);
    expect(fresh.length).toBe(2);
  });

  it("warnings are ignored", () => {
    expect(newErrors([], [warn(1, "w")])).toEqual([]);
    expect(newErrors([warn(1, "w")], [warn(1, "w"), warn(2, "w2")])).toEqual([]);
  });

  it("problemKey ignores line and whitespace runs", () => {
    expect(problemKey(err(1, "a  b"))).toBe(problemKey(err(9, "a b")));
    expect(problemKey(err(1, "a"))).not.toBe(problemKey(err(1, "b")));
  });

  it("pickProblems puts errors before warnings, then by line, capped", () => {
    const all = [warn(9, "w1"), err(5, "e2"), err(2, "e1"), warn(1, "w0"), { code: "I", severity: "info" as const, message: "i", line: 0 }];
    expect(pickProblems(all).map((p) => p.message)).toEqual(["e1", "e2", "w0", "w1"]);
    expect(pickProblems(all, 2).length).toBe(2);
  });

  it("renderProblem is 1-based and compact", () => {
    expect(renderProblem(err(41, "many   spaces here"))).toBe("line 42 [error] many spaces here");
  });
});
