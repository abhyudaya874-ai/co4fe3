export const BUDGET = {
  pack: 6000, packCap: 12000, firstMessage: 12000, inline: 3000,
  readLines: 400, readLinesCap: 800, searchHits: 50, repoMap: 2500, repoMapCap: 4000,
  symbolPack: 3000, symbolPackCap: 6000, commandBytes: 16384,
  retrieveFullMs: 800, retrieveQuickMs: 200,
} as const;

export interface Timer { set(fn: () => void, ms: number): unknown; clear(t: unknown): void }
export const realTimer: Timer = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as NodeJS.Timeout) };

/** Runs `full` under `fullMs`, then `quick` under `quickMs`, then gives `fallback`. Never rejects: a missing pack is "skip", not an error. */
export async function withinBudget<T>(full: () => Promise<T>, quick: () => Promise<T>, fallback: T, o: { fullMs: number; quickMs: number; timer?: Timer }): Promise<{ value: T; path: "full" | "quick" | "none" }> {
  const timer = o.timer ?? realTimer;
  const race = (p: Promise<T>, ms: number) => new Promise<T | undefined>((res) => {
    const t = timer.set(() => res(undefined), ms);
    p.then((v) => { timer.clear(t); res(v); }, () => { timer.clear(t); res(undefined); });
  });
  const a = await race(full(), o.fullMs);
  if (a !== undefined) return { value: a, path: "full" };
  const b = await race(quick(), o.quickMs);                         // quick is only started when full missed: no double work when warm
  return b !== undefined ? { value: b, path: "quick" } : { value: fallback, path: "none" };
}
