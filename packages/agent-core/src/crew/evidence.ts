import type { Profile } from "../runtime/modes.js";

export type MemberStatus = "running" | "waiting-approval" | "completed" | "blocked" | "failed" | "cancelled";
export const isTerminal = (s: MemberStatus): boolean => s === "completed" || s === "blocked" || s === "failed" || s === "cancelled";

/** Built ONLY from this member's own calls, which the pause sees by threadId. Never from a repo-wide diff. */
export interface MemberEvidence { proposals: number; hunksAccepted: number; hunksRejected: number; commands: number; filesChanged: string[] }
export const emptyEvidence = (): MemberEvidence => ({ proposals: 0, hunksAccepted: 0, hunksRejected: 0, commands: 0, filesChanged: [] });

const CLAIMS_EDIT = /\b(?:i\s+)?(?:edited|updated|modified|rewrote|refactored|patched|fixed|implemented|added|created|removed|deleted|changed|wrote)\b/i;

/** V3Code's "evidence over claims": a work member that reports edits it never got accepted is blocked, not completed. */
export function assessMemberOutcome(o: { profile: Profile; report: string; evidence: MemberEvidence; failed: boolean }): { status: MemberStatus; reason?: string } {
  if (o.failed) return { status: "failed" };
  if (o.profile === "work" && o.evidence.hunksAccepted === 0 && o.evidence.proposals > 0 && o.evidence.hunksRejected > 0)
    return { status: "blocked", reason: "The user rejected this member's edits." };
  if (o.profile === "work" && o.evidence.hunksAccepted === 0 && CLAIMS_EDIT.test(o.report))
    return { status: "blocked", reason: "The report claims changes, but none of this member's edits were accepted." };
  return { status: "completed" };
}
