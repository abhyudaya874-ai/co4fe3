import { describe, it, expect } from "vitest";
import { proposalEvent, settleProposalEvent } from "../src/review/view.js";
import { toHunks } from "../src/review/hunks.js";
import type { Proposal } from "../src/review/store.js";

const BEFORE = ["one", "two", "three", "four", "five", "six", "seven", ""].join("\n");
const AFTER = ["one", "two", "THREE", "four", "five", "six", "seven", "eight", ""].join("\n");

const proposal = (over: Partial<Proposal> = {}): Proposal => {
  const hunks = toHunks(BEFORE, AFTER);
  return { key: "k1", turnId: "t1", threadId: "main", toolCallId: "c1", by: "lead", path: "a.py", why: "shout", before: BEFORE, after: AFTER, hunks, verdict: Object.fromEntries(hunks.map((h) => [h.id, "pending" as const])), baseline: [], ...over };
};

describe("proposalEvent", () => {
  it("shows each hunk with its lines (no terminators) and two lines of context either side", () => {
    const e = proposalEvent(proposal());
    expect(e).toMatchObject({ kind: "proposal", key: "k1", path: "a.py", by: "lead", adds: 2, removes: 1 });
    expect(e.hunks[0]).toMatchObject({ id: "h1", oldStart: 2, oldLines: ["three"], newLines: ["THREE"], before: ["one", "two"], after: ["four", "five"] });
    expect(e.hunks[1]).toMatchObject({ id: "h2", oldLines: [], newLines: ["eight"], before: ["six", "seven"], after: [] });
  });
  it("a new file has no context and counts every line as added", () => {
    const hunks = toHunks("", "a\nb\n");
    const e = proposalEvent(proposal({ before: null, after: "a\nb\n", hunks, verdict: { h1: "pending" } }));
    expect(e.adds).toBe(2); expect(e.removes).toBe(0);
    expect(e.hunks[0]!.before).toEqual([]);
  });
  it("copies the verdicts, so a later decision does not rewrite an event already sent", () => {
    const p = proposal();
    const e = proposalEvent(p);
    p.verdict.h1 = "accepted";
    expect(e.verdict.h1).toBe("pending");
  });
  it("a very long hunk is cut and says how many lines are left out", () => {
    const big = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n") + "\n";
    const hunks = toHunks("", big);
    const e = proposalEvent(proposal({ before: null, after: big, hunks, verdict: { h1: "pending" } }));
    expect(e.hunks[0]!.newLines).toHaveLength(400);
    expect(e.hunks[0]!.hidden).toBe(600);
    expect(e.adds).toBe(1000);
  });
});

describe("settleProposalEvent", () => {
  it("applied records the checkpoint and the verify verdict", () => {
    const last = proposalEvent(proposal());
    const done = settleProposalEvent(last, { applied: { checkpointId: "cp9", newErrors: ["line 3: x"] } });
    expect(done.applied).toEqual({ checkpointId: "cp9", newErrors: ["line 3: x"] });
  });
  it("dropped marks only a proposal that still had undecided hunks", () => {
    const pending = proposalEvent(proposal());
    expect(settleProposalEvent(pending, { dropped: true }).dropped).toBe(true);
    const decided = proposalEvent(proposal({ verdict: { h1: "rejected", h2: "accepted" } }));
    expect(settleProposalEvent(decided, { dropped: true }).dropped).toBeUndefined();
  });
});
