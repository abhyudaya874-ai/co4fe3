import { describe, it, expect } from "vitest";
import { ReviewStore, proposalKeyOf, type Proposal } from "../src/review/store.js";

const prop = (over: Partial<Proposal> = {}): Proposal => ({
  key: over.key ?? "k1",
  turnId: "t1", threadId: "main", toolCallId: "c1", by: "lead",
  path: "a.py", why: "test", before: "one\ntwo\n", after: "ONE\ntwo\n",
  hunks: [{ id: "h1", oldStart: 0, oldLines: ["one\n"], newLines: ["ONE\n"] }],
  verdict: { h1: "pending" },
  baseline: [],
  ...over,
});

describe("ReviewStore (rule 30)", () => {
  it("settled resolves only when nothing is pending, and rejects on abort", async () => {
    const s = new ReviewStore();
    s.stage(prop());
    const ac = new AbortController();
    const wait = s.settled("k1", ac.signal);
    s.decide("k1", "h1", "accepted");
    await expect(wait).resolves.toEqual({ key: "k1", accepted: ["h1"], rejected: [] });

    const s2 = new ReviewStore();
    s2.stage(prop({ key: "k2" }));
    const ac2 = new AbortController();
    const wait2 = s2.settled("k2", ac2.signal);
    ac2.abort();
    await expect(wait2).rejects.toThrow("aborted");
  });

  it("take is one-shot and refuses while a hunk is pending", () => {
    const s = new ReviewStore();
    s.stage(prop({ key: "k3", hunks: [
      { id: "h1", oldStart: 0, oldLines: ["one\n"], newLines: ["ONE\n"] },
      { id: "h2", oldStart: 1, oldLines: ["two\n"], newLines: ["TWO\n"] },
    ], verdict: { h1: "pending", h2: "pending" } }));
    expect(s.take("k3")).toBeUndefined();
    s.decide("k3", "h1", "accepted");
    expect(s.take("k3")).toBeUndefined();          // h2 still pending
    s.decide("k3", "h2", "rejected");
    const taken = s.take("k3");
    expect(taken?.decision).toEqual({ key: "k3", accepted: ["h1"], rejected: ["h2"] });
    expect(s.take("k3")).toBeUndefined();          // one-shot
  });

  it("dropTurn drops only that turn's undecided proposals and returns their keys", () => {
    const s = new ReviewStore();
    s.stage(prop({ key: "kA", turnId: "t1" }));
    s.stage(prop({ key: "kB", turnId: "t2" }));
    expect(s.dropTurn("t1")).toEqual(["kA"]);
    expect(s.get("kA")).toBeUndefined();
    expect(s.get("kB")).toBeDefined();
  });

  it("decide throws on an unknown key or hunk; onChange fires", () => {
    const s = new ReviewStore();
    s.stage(prop({ key: "k5" }));
    const seen: string[] = [];
    s.onChange((k) => seen.push(k));
    expect(() => s.decide("nope", "h1", "accepted")).toThrow();
    expect(() => s.decide("k5", "hX", "accepted")).toThrow();
    s.decide("k5", "h1", "rejected");
    expect(seen).toEqual(["k5"]);                  // the listener was added after stage, so it sees only the decide
  });

  it("proposalKeyOf is stable across argument order and differs on content", () => {
    expect(proposalKeyOf("a.py", [{ oldString: "x", newString: "y" }], undefined))
      .toBe(proposalKeyOf("a.py", [{ newString: "y", oldString: "x" }], undefined));
    expect(proposalKeyOf("a.py", [{ oldString: "x", newString: "y" }], undefined))
      .not.toBe(proposalKeyOf("a.py", [{ oldString: "x", newString: "z" }], undefined));
  });
});
