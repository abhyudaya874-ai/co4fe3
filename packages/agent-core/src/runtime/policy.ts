import { stableStringify } from "../util/stable.js";

export const REPEAT_SOFT = 3;            // 3rd identical call: run it, append a reminder
export const REPEAT_HARD = 5;            // 5th identical call: refuse it
export const MISTAKE_LIMIT = 4;          // consecutive failed calls in the turn → safety stop (higher than V3Code's 3: members interleave)
export const MAX_TOOL_CALLS = 150;

export type CallDecision = { run: true; reminder?: string } | { run: false; message: string };

export class TurnPolicy {
  private counts = new Map<string, number>();
  private consecutiveFailures = 0;
  private calls = 0;
  private stopped: string | null = null;
  constructor(readonly turnId: string) {}

  before(tool: string, args: unknown): CallDecision {
    if (this.stopped) return { run: false, message: this.stopped };
    if (++this.calls > MAX_TOOL_CALLS) return { run: false, message: `Safety stop: over ${MAX_TOOL_CALLS} tool calls in this request. Answer with what you have.` };
    const key = `${tool}\0${stableStringify(args)}`;
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    if (n >= REPEAT_HARD) return { run: false, message: `You called ${tool} with these exact arguments ${n} times in this request. Use the earlier result and change approach; do not repeat it.` };
    if (n === REPEAT_SOFT) return { run: true, reminder: `Note: this is the 3rd identical ${tool} call. Use this result, change the arguments, or answer; do not call it again.` };
    return { run: true };
  }

  after(failed: boolean): { stop: boolean; message?: string } {
    this.consecutiveFailures = failed ? this.consecutiveFailures + 1 : 0;
    if (this.consecutiveFailures >= MISTAKE_LIMIT) {
      this.stopped = `Safety stop: ${this.consecutiveFailures} tool calls in a row failed. Stop calling tools; explain the blocker from the errors and what you need.`;
      return { stop: true, message: this.stopped };
    }
    return failed ? { stop: false, message: "That call failed. Read the error and make one materially different correction." } : { stop: false };
  }
}
