import { describe, it, expect } from "vitest";
import { TurnPolicy, REPEAT_SOFT, REPEAT_HARD, MISTAKE_LIMIT, MAX_TOOL_CALLS } from "../src/runtime/policy.js";
import { stableStringify, sha256Hex } from "../src/util/stable.js";

describe("TurnPolicy (rule 50 §2)", () => {
  it("the 3rd identical call carries the reminder and the 5th is refused", () => {
    const p = new TurnPolicy("t1");
    const args = { path: "a.py" };
    expect(p.before("read_file", args)).toEqual({ run: true });
    expect(p.before("read_file", args)).toEqual({ run: true });
    const third = p.before("read_file", args);
    expect(third.run).toBe(true);
    if (third.run) expect(third.reminder).toContain("3rd identical read_file");
    for (let i = 0; i < REPEAT_HARD - REPEAT_SOFT - 1; i++) expect(p.before("read_file", args).run).toBe(true);
    const fifth = p.before("read_file", args);
    expect(fifth).toEqual({ run: false, message: expect.stringContaining("5 times") });
  });

  it("different arguments are counted separately", () => {
    const p = new TurnPolicy("t1");
    for (let i = 0; i < REPEAT_HARD - 1; i++) expect(p.before("read_file", { path: `f${i}.py` }).run).toBe(true);
  });

  it("4 failures in a row stop the turn, after which every call is refused; one success resets", () => {
    const p = new TurnPolicy("t1");
    for (let i = 1; i < MISTAKE_LIMIT; i++) expect(p.after(true).stop).toBe(false);
    const stop = p.after(true);
    expect(stop.stop).toBe(true);
    expect(p.before("read_file", {})).toEqual({ run: false, message: expect.stringContaining("Safety stop") });
    const fresh = new TurnPolicy("t2");
    fresh.after(true);
    expect(fresh.after(false)).toEqual({ stop: false });
    expect(fresh.after(true)).toEqual({ stop: false, message: expect.stringContaining("materially different") });
  });

  it("the 151st call is refused", () => {
    const p = new TurnPolicy("t1");
    for (let i = 0; i < MAX_TOOL_CALLS; i++) p.before("read_file", { n: i });
    expect(p.before("read_file", { n: "last" }).run).toBe(false);
  });
});

describe("stable.ts", () => {
  it("stableStringify is key-order independent and array-order preserving", () => {
    expect(stableStringify({ b: 1, a: [2, 1] })).toBe(stableStringify({ a: [2, 1], b: 1 }));
    expect(stableStringify({ a: 1, b: "x" })).toBe(`{"a":1,"b":"x"}`);
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("sha256Hex matches known vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
