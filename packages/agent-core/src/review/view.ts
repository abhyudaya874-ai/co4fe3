import type { Proposal } from "./store.js";
import type { PanelEvent, HunkView } from "../panel/events.js";
import { splitLines } from "./lines.js";

export type ProposalEvent = Extract<PanelEvent, { kind: "proposal" }>;

const bare = (l: string): string => l.replace(/\r?\n$/, "");
const MAX_SIDE = 400;                                                  // lines shown per side of one hunk; the rest is counted, not sent

/** The diff card for a staged proposal: hunks with two lines of context either side, counts, and the current verdicts. Pure. */
export function proposalEvent(p: Proposal, o: { applied?: ProposalEvent["applied"]; dropped?: boolean; context?: number } = {}): ProposalEvent {
  const ctx = o.context ?? 2;
  const old = p.before === null ? [] : splitLines(p.before);
  let adds = 0, removes = 0;
  const hunks: HunkView[] = p.hunks.map((h) => {
    adds += h.newLines.length; removes += h.oldLines.length;
    const from = Math.max(0, h.oldStart - ctx), to = h.oldStart + h.oldLines.length;
    const view: HunkView = {
      id: h.id, oldStart: h.oldStart,
      oldLines: h.oldLines.slice(0, MAX_SIDE).map(bare), newLines: h.newLines.slice(0, MAX_SIDE).map(bare),
      before: old.slice(from, h.oldStart).map(bare), after: old.slice(to, to + ctx).map(bare),
    };
    const hidden = Math.max(0, h.oldLines.length - MAX_SIDE) + Math.max(0, h.newLines.length - MAX_SIDE);
    return hidden ? { ...view, hidden } : view;
  });
  return {
    kind: "proposal", key: p.key, path: p.path, why: p.why, by: p.by, adds, removes, hunks,
    verdict: { ...p.verdict },
    ...(o.applied ? { applied: o.applied } : {}),
    ...(o.dropped ? { dropped: true } : {}),
  };
}

/** The proposal as it was last shown, now finished: applied (with the verify verdict) or dropped. */
export function settleProposalEvent(last: ProposalEvent, o: { applied?: NonNullable<ProposalEvent["applied"]>; dropped?: boolean }): ProposalEvent {
  if (o.applied) return { ...last, applied: o.applied, dropped: undefined };
  const undecided = last.hunks.some((h) => last.verdict[h.id] === "pending");
  return o.dropped && undecided ? { ...last, dropped: true } : last;
}
