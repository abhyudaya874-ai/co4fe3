import type { PanelEvent } from "@co4fe3/agent-core/panel";
import { assessMemberOutcome, emptyEvidence, isTerminal, crewWatch, emptyWatch, type MemberEvidence, type MemberStatus } from "@co4fe3/agent-core";
import { briefOf } from "@co4fe3/agent-core";
import type { TfEvent } from "@co4fe3/agent-core";

interface Member { threadId: string; title: string; profile: "research" | "work"; status: MemberStatus; reason?: string; evidence: MemberEvidence; done: boolean }

/** The runtime crew's state, folded over the turn's events (rule 50). The panel renders what this produces. */
export class Crew {
  private members = new Map<string, Member>();
  private w = emptyWatch();

  constructor(private mode: "agent" | "ask" | "plan", private push: (e: PanelEvent) => void) {}

  /** Per request: members and the watchdog count belong to one turn. */
  reset(mode: "agent" | "ask" | "plan"): void { this.members.clear(); this.w = emptyWatch(); this.mode = mode; }

  /** Feed every TrueForge event. Returns a stop sentence when the watchdog trips (the caller aborts the turn with it). */
  onEvent(e: TfEvent): string | null {
    if (e.type === "thread.created") {
      const brief = briefOf(e);
      const profile = parseProfileOf(brief, this.mode);
      this.members.set(e.threadId, { threadId: e.threadId, title: e.title, profile, status: "running", evidence: emptyEvidence(), done: false });
      this.push({ kind: "member", threadId: e.threadId, title: e.title, profile, status: "running" });
      this.push({ kind: "message", id: `to-${e.threadId}`, from: "main", to: e.title, text: brief });
    } else if (e.type === "thread.done") {
      const m = this.members.get(e.threadId);
      if (!m) return null;
      const report = textOfEvent(e);
      m.done = true;
      const verdict = assessMemberOutcome({ profile: m.profile, report, evidence: m.evidence, failed: e.state.status !== "done" });
      m.status = verdict.status;
      m.reason = verdict.reason;
      this.push({ kind: "member", threadId: e.threadId, title: e.title, profile: m.profile, status: verdict.status, reason: verdict.reason });
      this.push({ kind: "message", id: `from-${e.threadId}`, from: e.title, to: "main", text: report || (e.state.status === "error" ? String(e.state.error ?? "") : "") });
    }
    const r = crewWatch(this.w, e); this.w = r.s;
    return r.stop;
  }

  member(threadId: string): Member | undefined { return this.members.get(threadId); }

  setStatus(threadId: string, status: MemberStatus): void {
    const m = this.members.get(threadId);
    if (!m || m.done) return;
    m.status = status;
    this.push({ kind: "member", threadId, title: m.title, profile: m.profile, status, reason: m.reason });
  }

  record(threadId: string, add: Partial<MemberEvidence>): void {
    const m = this.members.get(threadId);
    if (!m) return;
    m.evidence = {
      proposals: m.evidence.proposals + (add.proposals ?? 0),
      hunksAccepted: m.evidence.hunksAccepted + (add.hunksAccepted ?? 0),
      hunksRejected: m.evidence.hunksRejected + (add.hunksRejected ?? 0),
      commands: m.evidence.commands + (add.commands ?? 0),
      filesChanged: [...m.evidence.filesChanged, ...(add.filesChanged ?? [])],
    };
  }

  finish(threadId: string, report: string, failed: boolean): void {
    const m = this.members.get(threadId);
    if (!m || m.done) return;
    m.done = true;
    const verdict = assessMemberOutcome({ profile: m.profile, report, evidence: m.evidence, failed });
    m.status = verdict.status;
    m.reason = verdict.reason;
    this.push({ kind: "member", threadId, title: m.title, profile: m.profile, status: verdict.status, reason: verdict.reason });
  }

  /** Stop: every non-terminal member becomes `cancelled` FIRST (V3Code's abortRunning order). */
  cancelAll(): PanelEvent[] {
    const out: PanelEvent[] = [];
    for (const m of this.members.values()) {
      if (isTerminal(m.status)) continue;
      m.status = "cancelled";
      m.done = true;
      out.push({ kind: "member", threadId: m.threadId, title: m.title, profile: m.profile, status: "cancelled" });
    }
    return out;
  }
}

const PROFILE_LINE = /^\s*(?:PROFILE|ROLE):\s*([a-z]+)/im;
const WORK_WORDS = new Set(["work", "edit", "test", "write", "fix"]);
const parseProfileOf = (brief: string, mode: "agent" | "ask" | "plan"): "research" | "work" => {
  if (mode !== "agent") return "research";
  const word = PROFILE_LINE.exec(brief)?.[1]?.toLowerCase();
  return word !== undefined && WORK_WORDS.has(word) ? "work" : "research";
};
const textOfEvent = (e: Extract<TfEvent, { type: "thread.done" }>): string => {
  const c = (e.state.output as { content?: unknown } | undefined)?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p && typeof p === "object" && "text" in p && typeof p.text === "string" ? p.text : "")).join("");
  return "";
};
