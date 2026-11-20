export interface ModelStat { fqn: string; ttft: number[]; ok: number; fail: number; benchedUntil: number; lastError?: string }
export const emptyStat = (fqn: string): ModelStat => ({ fqn, ttft: [], ok: 0, fail: 0, benchedUntil: 0 });

export function record(s: ModelStat, r: { ok: true; ttftMs: number } | { ok: false; benchMs: number; error: string }, now: number): ModelStat {
  return r.ok
    ? { ...s, ttft: [...s.ttft, r.ttftMs].slice(-20), ok: s.ok + 1 }
    : { ...s, fail: s.fail + 1, benchedUntil: Math.max(s.benchedUntil, now + r.benchMs), lastError: r.error };
}
export function percentile(xs: readonly number[], p: number): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]!;
}
/** The user's order minus benched models (all benched → user's order: try anyway). `byLatency` reorders healthy models with ≥3 samples by p50 TTFT. */
export function orderModels(prefs: readonly string[], stats: Readonly<Record<string, ModelStat>>, now: number, byLatency: boolean): string[] {
  const healthy = prefs.filter((m) => (stats[m]?.benchedUntil ?? 0) <= now);
  const base = healthy.length ? healthy : [...prefs];
  if (!byLatency) return base;
  const p50 = (m: string) => (stats[m] && stats[m]!.ttft.length >= 3 ? percentile(stats[m]!.ttft, 50)! : Number.POSITIVE_INFINITY);
  return [...base].sort((a, b) => p50(a) - p50(b) || base.indexOf(a) - base.indexOf(b));
}
/** Start the hedge at this model's p90 TTFT, clamped to [2.5 s, 8 s]; 4 s until there are 3 samples. */
export function hedgeDelayMs(s: ModelStat | undefined): number {
  const p90 = s && s.ttft.length >= 3 ? percentile(s.ttft, 90)! : 4000;
  return Math.min(8000, Math.max(2500, Math.round(p90 * 1.2)));
}
/** No first token by this time = stalled: cancel and fall back. Twice p90, clamped to [8 s, 20 s]; 12 s until sampled. */
export function stallMs(s: ModelStat | undefined): number {
  const p90 = s && s.ttft.length >= 3 ? percentile(s.ttft, 90)! : 6000;
  return Math.min(20_000, Math.max(8000, p90 * 2));
}
/** After the first token: no TrueForge event at all for this long = stalled (reset on EVERY event, paused during a review). */
export const IDLE_STALL_MS = 45_000;
