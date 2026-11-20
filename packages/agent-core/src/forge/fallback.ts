import type { TurnOutcome } from "./turn.js";
export type FailKind = "auth" | "not_found" | "rate" | "unreachable" | "stall" | "server" | "context" | "unknown";
export interface Failure { kind: FailKind; benchMs: number; retrySame: boolean; detail: string }

const RULES: [FailKind, RegExp, number, boolean][] = [
  ["auth", /\b(401|403)\b|unauthori[sz]ed|invalid[^.]{0,30}(api[ _-]?key|token|credential)|permission denied/i, 600_000, false],
  ["not_found", /\b404\b|model[^.]{0,40}(not found|does not exist)|unknown model/i, 600_000, false],
  ["rate", /\b429\b|rate.?limit|quota|resource.?exhausted|too many requests/i, 60_000, false],
  ["unreachable", /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|getaddrinfo|fetch failed|connect(ion)? refused|network error|socket hang up|cannot connect/i, 60_000, false],
  ["context", /context.{0,20}(length|window)|maximum context|too many (input )?tokens/i, 0, false],
  ["server", /\b5\d\d\b|overloaded|unavailable|bad gateway|internal server error/i, 30_000, true],
  ["stall", /stall|timed? ?out|ETIMEDOUT|deadline/i, 60_000, true],
];
export function classifyFailure(message: string): Failure {
  for (const [kind, re, benchMs, retrySame] of RULES) if (re.test(message)) return { kind, benchMs: kind === "rate" ? retryAfterMs(message) ?? benchMs : benchMs, retrySame, detail: firstLine(message) };
  return { kind: "unknown", benchMs: 30_000, retrySame: true, detail: firstLine(message) };
}
/** "retry in 57.1s" / "Retry-After: 30" → ms + 500, capped at 1 h. */
export const retryAfterMs = (m: string): number | null => { const x = /retry(?:-after)?[^0-9]{0,12}(\d+(?:\.\d+)?)\s*s/i.exec(m); return x ? Math.min(3_600_000, Math.ceil(Number(x[1]) * 1000) + 500) : null; };
export const backoffMs = (n: number, rand = Math.random): number => Math.min(4000, 500 * 2 ** n) + Math.floor(rand() * 250);

const firstLine = (m: string): string => m.split("\n")[0]!.trim();

export interface AttemptResult { outcome: TurnOutcome; sideEffects: boolean; firstTokenMs: number | null }
export type RunOn = (model: string, attempt: number, signal: AbortSignal) => Promise<AttemptResult>;
export type Note = { kind: "attempt"; model: string; n: number } | { kind: "failed"; model: string; failure: Failure; next: string | null } | { kind: "answered"; model: string; fellBack: boolean };

/** Tries models in order. Same model again only for retrySame kinds, once, after backoff. Never retries after a side effect. */
export async function runWithFallback(models: readonly string[], runOn: RunOn, note: (n: Note) => void, signal: AbortSignal, sleep: (ms: number, s: AbortSignal) => Promise<void>): Promise<{ model: string; result: AttemptResult } | { model: null; failures: { model: string; failure: Failure }[] }> {
  const failures: { model: string; failure: Failure }[] = [];
  let n = 0;
  for (const [i, model] of models.entries()) {
    for (let same = 0; same < 2; same++) {
      if (signal.aborted) return { model: null, failures };
      note({ kind: "attempt", model, n: ++n });
      const r = await runOn(model, n, signal);
      const stalled = r.outcome.status === "cancelled" && r.outcome.reason === "stall";   // runOn sets reason "stall" when ITS stall timer fired
      if (signal.aborted || (r.outcome.status === "cancelled" && !stalled)) return { model, result: r };   // the user pressed Stop: no banner, no fallback
      if (r.outcome.status === "done") { note({ kind: "answered", model, fellBack: i > 0 }); return { model, result: r }; }
      const failure: Failure = r.outcome.status === "error" ? classifyFailure(r.outcome.message ?? "") : { kind: "stall", benchMs: 60_000, retrySame: false, detail: "no first token in time" };
      failures.push({ model, failure });
      const next = r.sideEffects ? null : (failure.retrySame && same === 0 ? model : models[i + 1] ?? null);
      note({ kind: "failed", model, failure, next });
      if (r.sideEffects) return { model: null, failures };              // a tool already ran: the user decides
      if (!(failure.retrySame && same === 0)) break;                    // move to the next model
      await sleep(backoffMs(same), signal);
    }
  }
  return { model: null, failures };
}
