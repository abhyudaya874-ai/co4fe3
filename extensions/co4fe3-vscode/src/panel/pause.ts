import * as vscode from "vscode";
import type { EditorHost, Proposal, PendingCall, TurnHooks, TrueForgeApi } from "@co4fe3/agent-core";
import { ProposeEdit, proposalKey, planEdit, toHunks, jail, allow, deny, reply, memberMayCall, toolNameOf, safeJson } from "@co4fe3/agent-core";
import type { ReviewController } from "../review/controller.js";
import type { Crew } from "./crew.js";

export interface PauseDeps {
  host: EditorHost;
  review: ReviewController;
  crew: Crew;
  serverName: string;
  mode: "agent" | "ask" | "plan";
  turnKey: string;
  sideEffect(): void;
  autoApproveTerminal: boolean;
  approveCommand(p: PendingCall, signal: AbortSignal): Promise<TrueForgeApi.TurnUserEventMessage>;
}

export type PauseMaker = (d: PauseDeps) => TurnHooks["onPause"];

/** Parses the call's arguments with the propose_edit schema and returns the jailed path, or null. */
export function jailedPathArg(root: string, call: PendingCall["call"]): string | null {
  const v = ProposeEdit.safeParse(safeJson(call?.function?.arguments));
  if (!v.success) return null;
  try { return jail(root, v.data.path); } catch { return null; }
}

export function makeOnPause(d: PauseDeps): TurnHooks["onPause"] {
  return async (pending, _index, signal) => {
    // One review per file per pause (rule 30, V3Code "reject-conflicts"): later edits to an already-claimed path are denied.
    const claimed = new Set<string>(), conflicts = new Set<PendingCall>();
    for (const p of pending) {
      if (toolNameOf(p.call, d.serverName) !== "propose_edit") continue;
      const path = jailedPathArg(d.host.root, p.call);            // null when the args or the path are invalid (reviewEdit denies those)
      if (path === null) continue;
      if (claimed.has(path)) conflicts.add(p); else claimed.add(path);
    }
    return Promise.all(pending.map(async (p): Promise<TrueForgeApi.TurnUserEventMessage> => {
      if (p.kind === "response") return reply(p, "This client does not support client-side tools.");
      const tool = toolNameOf(p.call, d.serverName);             // our server only; preloaded → toolInfo.type === "mcp"
      if (!tool) return deny(p, "Unknown tool.");
      const member = d.crew.member(p.threadId);                  // undefined for the lead ("main")
      if (member && !memberMayCall(member.profile, d.mode, tool))
        return deny(p, `${member.profile} members do not call ${tool}. Report what should change and where; the lead will do it.`);
      if (conflicts.has(p)) return deny(p, `Another edit to ${jailedPathArg(d.host.root, p.call) ?? "the file"} was reviewed in this same step. Read the file again, then propose your remaining change.`);
      d.crew.setStatus(p.threadId, "waiting-approval");          // shown on the member row while the user decides
      try {
        if (tool === "propose_edit") return await reviewEdit(d, p, member?.title ?? "lead", signal);
        if (tool === "run_command") return await d.approveCommand(p, signal);   // commandPolicy, autoApprove.terminal, else a card with Allow / Deny
        return allow(p);
      } finally { d.crew.setStatus(p.threadId, "running"); }
    }));
  };
}

async function reviewEdit(d: PauseDeps, p: PendingCall, by: string, signal: AbortSignal): Promise<TrueForgeApi.TurnUserEventMessage> {
  const v = ProposeEdit.safeParse(safeJson(p.call?.function?.arguments));
  if (!v.success) return deny(p, `Invalid propose_edit arguments: ${v.error.issues.map((i) => i.message).join("; ")}`);
  let rel: string;
  try { rel = jail(d.host.root, v.data.path); } catch (e) { return deny(p, (e as Error).message); }
  const before = await d.host.readText(rel);
  const plan = planEdit(before, (v.data.edits ?? []).map((x) => ({ oldString: x.old_string, newString: x.new_string })), v.data.content);
  if (!plan.ok) return deny(p, plan.error);                      // the model learns now; the user never sees a broken edit
  const baseline = await d.host.problems(rel);                   // verify-after-apply compares against this (rule 30)
  const hunks = toHunks(before ?? "", plan.after);
  const proposal: Proposal = { key: proposalKey(rel, v.data), turnId: d.turnKey, threadId: p.threadId, toolCallId: p.toolCallId, by, path: rel, why: v.data.why, before, after: plan.after, hunks, verdict: Object.fromEntries(hunks.map((h) => [h.id, "pending" as const])), baseline };
  const decision = await d.review.review(proposal, signal);      // panel card + diff editor; resolves when every hunk is decided
  d.crew.record(p.threadId, { proposals: 1, hunksAccepted: decision.accepted.length, hunksRejected: decision.rejected.length, filesChanged: decision.accepted.length ? [rel] : [] });   // evidence (rule 50 §4)
  if (!decision.accepted.length) return deny(p, `The user rejected all ${proposal.hunks.length} hunks for ${rel}. Do not propose them again unless asked.`);
  d.sideEffect();                                                // from here a fallback retry is not allowed (rule 70)
  return allow(p);                                               // TrueForge now runs propose_edit → handler writes the accepted hunks
}

export { vscode };
