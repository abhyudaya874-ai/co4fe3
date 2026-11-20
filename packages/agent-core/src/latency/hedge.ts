import { realTimer, type Timer } from "../context/budget.js";
import type { Failure } from "../forge/fallback.js";

export type Attempt<T> = (signal: AbortSignal, onFirstToken: () => void) => Promise<T>;

/** Thrown by a hedge attempt that failed (carries the classified failure for the all-failed line). */
export class AttemptFailed extends Error {
  constructor(readonly model: string, readonly failure: Failure) { super(`${model}: ${failure.detail}`); }
}

/** Collect the per-model failures a hedge race produced (insertion order = attempt order). */
export function collectFailures(e: unknown): { model: string; failure: Failure }[] {
  if (e instanceof AttemptFailed) return [{ model: e.model, failure: e.failure }];
  if (e instanceof AggregateError) return e.errors.flatMap((x) => collectFailures(x));
  return [];
}

/** Starts `a`. Starts `b` after `delayMs` if `a` has not streamed yet, or at once if `a` fails before streaming.
 *  The first attempt to stream "leads": the other is aborted. Resolves with the leader's result. */
export function hedged<T>(a: Attempt<T>, b: Attempt<T> | null, delayMs: number, outer: AbortSignal, timer: Timer = realTimer): Promise<{ winner: "a" | "b"; value: T }> {
  return new Promise((resolve, reject) => {
    const ca = new AbortController(), cb = new AbortController();
    let leader: "a" | "b" | null = null, startedB = false, failures = 0, lastErr: unknown;
    const kill = (): void => { ca.abort(); cb.abort(); };
    outer.addEventListener("abort", kill, { once: true });
    const lead = (who: "a" | "b") => (): void => { if (leader) return; leader = who; (who === "a" ? cb : ca).abort(); };
    const settle = (who: "a" | "b") => (p: Promise<T>): void => { void p.then(
      (value) => { if (leader === null || leader === who) { leader = who; kill(); resolve({ winner: who, value }); } },
      (err) => { lastErr = err; if (leader === who) reject(lastErr);            // the leader failed after winning: nothing left to lead
        else if (++failures === (startedB ? 2 : 1) && (startedB || !b)) reject(lastErr); else if (who === "a" && !startedB) startB(); });
    };
    const startB = (): void => { if (!b || startedB || leader || outer.aborted) return; startedB = true; settle("b")(b(AbortSignal.any([cb.signal, outer]), lead("b"))); };
    settle("a")(a(AbortSignal.any([ca.signal, outer]), lead("a")));
    const t = timer.set(startB, delayMs);
    outer.addEventListener("abort", () => timer.clear(t), { once: true });
  });
}
