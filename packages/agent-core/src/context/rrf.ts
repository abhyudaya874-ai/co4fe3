export interface Fused { id: string; score: number; ranks: number[] }   // ranks[c] = 1-based rank in channel c, 0 = absent

/** Reciprocal Rank Fusion (Cormack, Clarke & Büttcher, SIGIR 2009; V3Code uses the same): score(d) = Σ 1 / (k + rank_c(d)). */
export function rrfMerge(channels: readonly (readonly string[])[], k = 60): Fused[] {
  if (k <= 0) throw new Error("rrfMerge: k must be positive");
  const acc = new Map<string, Fused>();
  channels.forEach((list, c) => list.forEach((id, i) => {
    const e = acc.get(id) ?? { id, score: 0, ranks: new Array<number>(channels.length).fill(0) };
    if (e.ranks[c] !== 0) return;                     // a channel lists an id once; ignore duplicates
    e.ranks[c] = i + 1;
    e.score += 1 / (k + i + 1);
    acc.set(id, e);
  }));
  return [...acc.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));   // deterministic ties
}
