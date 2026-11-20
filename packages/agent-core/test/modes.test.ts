import { describe, it, expect } from "vitest";
import { TOOLS, APPROVAL, READ_ONLY, toolsForMode, toolsForProfile, memberMayCall, parseProfile } from "../src/runtime/modes.js";

describe("modes (rule 50 §1)", () => {
  it("every tool is in TOOLS exactly once", () => {
    expect(new Set(TOOLS).size).toBe(TOOLS.length);
    expect(TOOLS.length).toBe(12);
  });

  it("READ_ONLY contains no key of APPROVAL", () => {
    for (const t of READ_ONLY) expect(t in APPROVAL).toBe(false);
    expect(Object.keys(APPROVAL).sort()).toEqual(["propose_edit", "run_command"]);
  });

  it("toolsForMode('ask') has no gated tool", () => {
    for (const t of toolsForMode("ask")) expect(t in APPROVAL).toBe(false);
    for (const t of toolsForMode("plan")) expect(t in APPROVAL).toBe(false);
    expect(toolsForMode("plan")).toEqual([...READ_ONLY, "write_plan"]);   // Plan = Ask + write_plan
    expect(toolsForMode("ask")).not.toContain("write_plan");
    expect(toolsForMode("agent")).toEqual(TOOLS);
  });

  it("only the Plan-mode lead may write a plan: research members never get write_plan", () => {
    expect(memberMayCall("research", "plan", "write_plan")).toBe(false);
    expect(memberMayCall("research", "plan", "read_file")).toBe(true);
  });

  it("research members lose the gated tools; work members keep the mode's set", () => {
    expect(memberMayCall("research", "agent", "propose_edit")).toBe(false);
    expect(memberMayCall("research", "agent", "read_file")).toBe(true);
    expect(memberMayCall("work", "agent", "propose_edit")).toBe(true);
    expect(memberMayCall("work", "ask", "propose_edit")).toBe(false);
  });

  it("parseProfile covers PROFILE: work, role: Edit, a missing line, and ask mode forcing research", () => {
    expect(parseProfile("PROFILE: work\nfind the tests", "agent")).toBe("work");
    expect(parseProfile("role: Edit\nfix the bug", "agent")).toBe("work");
    expect(parseProfile("PROFILE: research", "agent")).toBe("research");
    expect(parseProfile("no profile line here", "agent")).toBe("research");
    expect(parseProfile("PROFILE: nonsense", "agent")).toBe("research");
    expect(parseProfile("PROFILE: work", "ask")).toBe("research");
  });
});
