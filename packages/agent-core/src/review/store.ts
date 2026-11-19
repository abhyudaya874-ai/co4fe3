import type { Hunk } from "./hunks.js";
import type { Problem } from "../host.js";
import { stableStringify, sha256Hex } from "../util/stable.js";

export interface Proposal {
  key: string;            // proposalKey(path, edits, content): sha256 of stableStringify — the SAME function in the pause and the handler
  turnId: string; threadId: string; toolCallId: string; by: string;   // `by` = crew member title, or "inline"
  path: string; why: string; before: string | null; after: string; hunks: Hunk[];
  verdict: Record<string, "pending" | "accepted" | "rejected">;
  baseline: Problem[];    // language-server problems at review time (verify.ts); [] when none
}
export interface Decision { key: string; accepted: string[]; rejected: string[] }

export const proposalKeyOf = (path: string, edits: unknown, content: unknown): string =>
  sha256Hex(stableStringify({ path, edits: edits ?? null, content: content ?? null }));

export class ReviewStore {
  private proposals = new Map<string, Proposal>();
  private waiting = new Map<string, { resolve: (d: Decision) => void; reject: (e: Error) => void }>();
  private listeners = new Set<(key: string) => void>();

  stage(p: Proposal): void {
    this.proposals.set(p.key, p);
    for (const fn of this.listeners) fn(p.key);
  }

  get(key: string): Proposal | undefined { return this.proposals.get(key); }

  /** Every staged proposal, oldest first (the newest is the one just opened). */
  all(): Proposal[] { return [...this.proposals.values()]; }

  onChange(fn: (key: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  decide(key: string, hunkId: string, v: "accepted" | "rejected"): void {
    const p = this.proposals.get(key);
    if (!p) throw new Error(`decide: unknown proposal ${key}`);
    if (!(hunkId in p.verdict)) throw new Error(`decide: unknown hunk ${hunkId} of ${key}`);
    p.verdict[hunkId] = v;
    for (const fn of this.listeners) fn(key);
    this.settleIfDone(key, p);
  }

  decideAll(key: string, v: "accepted" | "rejected"): void {
    const p = this.proposals.get(key);
    if (!p) throw new Error(`decideAll: unknown proposal ${key}`);
    for (const h of p.hunks) p.verdict[h.id] = v;
    for (const fn of this.listeners) fn(key);
    this.settleIfDone(key, p);
  }

  /** Resolves when no hunk of `key` is pending. Rejects when `signal` aborts (Stop). */
  settled(key: string, signal: AbortSignal): Promise<Decision> {
    const p = this.proposals.get(key);
    if (!p) return Promise.reject(new Error(`settled: unknown proposal ${key}`));
    const pending = p.hunks.filter((h) => p.verdict[h.id] === "pending");
    if (pending.length === 0) return Promise.resolve(decisionOf(p));
    return new Promise<Decision>((resolve, reject) => {
      const onAbort = () => { cleanup(); reject(new Error("review aborted")); };
      signal.addEventListener("abort", onAbort, { once: true });
      const off = this.onChange((k) => {
        if (k !== key) return;
        if (!p.hunks.some((h) => p.verdict[h.id] === "pending")) { cleanup(); resolve(decisionOf(p)); }
      });
      const cleanup = () => { signal.removeEventListener("abort", onAbort); off(); this.waiting.delete(key); };
      this.waiting.set(key, { resolve, reject });
    });
  }

  /** One-shot: returns the decision and removes it. The MCP handler calls this exactly once per execution. */
  take(key: string): { proposal: Proposal; decision: Decision } | undefined {
    const p = this.proposals.get(key);
    if (!p) return undefined;
    if (p.hunks.some((h) => p.verdict[h.id] === "pending")) return undefined;
    this.proposals.delete(key);
    return { proposal: p, decision: decisionOf(p) };
  }

  /** Stop or turn end: drops every proposal of the turn that was not taken. Returns the dropped keys (to close their diff editors). */
  dropTurn(turnId: string): string[] {
    const dropped: string[] = [];
    for (const [key, p] of this.proposals) {
      if (p.turnId !== turnId) continue;
      this.proposals.delete(key);
      dropped.push(key);
      for (const fn of this.listeners) fn(key);
    }
    return dropped;
  }

  private settleIfDone(key: string, p: Proposal): void {
    if (p.hunks.some((h) => p.verdict[h.id] === "pending")) return;
    const w = this.waiting.get(key);
    if (w) { this.waiting.delete(key); w.resolve(decisionOf(p)); }
  }
}

const decisionOf = (p: Proposal): Decision => ({
  key: p.key,
  accepted: p.hunks.filter((h) => p.verdict[h.id] === "accepted").map((h) => h.id),
  rejected: p.hunks.filter((h) => p.verdict[h.id] === "rejected").map((h) => h.id),
});
