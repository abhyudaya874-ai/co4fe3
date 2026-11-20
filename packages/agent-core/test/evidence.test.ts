import { describe, it, expect } from "vitest";
import { assessMemberOutcome, emptyEvidence } from "../src/crew/evidence.js";

const base = { report: "", failed: false };

describe("assessMemberOutcome (rule 50 §4: evidence over claims)", () => {
  it("work member claiming edits with 0 accepted hunks → blocked", () => {
    const r = assessMemberOutcome({ ...base, profile: "work", report: "I updated cli.py to add the command.", evidence: { ...emptyEvidence(), proposals: 1 } });
    expect(r.status).toBe("blocked");
    expect(r.reason).toContain("none of this member's edits were accepted");
  });

  it("same claim with 1 accepted hunk → completed", () => {
    const r = assessMemberOutcome({ ...base, profile: "work", report: "I updated cli.py.", evidence: { ...emptyEvidence(), proposals: 1, hunksAccepted: 2, filesChanged: ["src/flask/cli.py"] } });
    expect(r.status).toBe("completed");
  });

  it("research member is never blocked", () => {
    const r = assessMemberOutcome({ ...base, profile: "research", report: "I updated nothing; cli.py registers commands in FlaskGroup.__init__.", evidence: emptyEvidence() });
    expect(r.status).toBe("completed");
  });

  it("all hunks rejected → blocked with the rejection reason", () => {
    const r = assessMemberOutcome({ ...base, profile: "work", report: "Done.", evidence: { ...emptyEvidence(), proposals: 2, hunksRejected: 3 } });
    expect(r.status).toBe("blocked");
    expect(r.reason).toContain("rejected");
  });

  it("failed → failed", () => {
    expect(assessMemberOutcome({ profile: "work", report: "x", evidence: emptyEvidence(), failed: true }).status).toBe("failed");
  });
});
