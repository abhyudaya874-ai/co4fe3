import { extractSymbols, type Sym } from "./symbols.js";
import { estimateTokens } from "./tokens.js";
import { rrfMerge } from "./rrf.js";

export interface FileEntry { path: string; text: string; tokens: number; syms: Sym[]; terms: Map<string, number>; uses: Set<string> }
export interface RepoIndex {
  files: FileEntry[];
  byPath: Map<string, FileEntry>;
  defs: Map<string, { path: string; line: number; sig: string }[]>;   // symbol name → its definitions
  users: Map<string, Set<string>>;                                     // symbol name → files that use it
  graph: Map<string, Map<string, number>>;                             // F → (G → weight): F uses a name that G defines
  idf: Map<string, number>;                                            // stemmed term → log(1 + N / (1 + df))
}
export interface RankQuery { text: string; mentioned: string[]; active?: string; recent: string[]; grepHits?: Map<string, number> }
export type Channel = "lexical" | "graph" | "grep" | "recent";
export const CHANNELS: readonly Channel[] = ["lexical", "graph", "grep", "recent"];
export interface Ranked { path: string; score: number; ranks: Record<Channel, number>; why: string[] }

const CHANNEL_DEPTH = 60;   // V3Code's per-channel pool: max(2 × topK, 60)
const MAX_DEFINERS = 5;     // names defined in more files than this are noise (app, run, get)

const STOP = new Set("the and for that with this from into any all must should new add make its are was were has have not but also each every other value values as be by of to in on or an it is".split(" "));
export const stem = (w: string): string => w.replace(/(ations?|ings?|ed|es|s)$/, "") || w;

export function queryTerms(text: string): string[] {
  const words = text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
  return [...new Set(words.map(stem))];
}

/** "document" matches "docs", "test" matches "tests": a shared stem prefix of ≥ 3 chars. */
export const termMatches = (term: string, token: string): boolean => {
  const a = stem(token.toLowerCase());
  return a === term || (a.length >= 3 && term.length >= 3 && (a.startsWith(term) || term.startsWith(a)));
};

export interface LexWeights { path: number; def: number; tf: number }
export const LEX: LexWeights = { path: 3, def: 2, tf: 1 };

export function lexicalScore(f: FileEntry, terms: readonly string[], idf: ReadonlyMap<string, number>, w: LexWeights = LEX): { score: number; hits: string[] } {
  const segs = f.path.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let score = 0; const hits: string[] = [];
  for (const t of terms) {
    const idfW = idf.get(t) ?? 1;
    const segsHit = segs.filter((s) => termMatches(t, s)).length;
    if (segsHit) { score += w.path * idfW * Math.min(2, segsHit); hits.push(`path matches "${t}"`); }
    const defs = f.syms.filter((s) => s.name.split(/_|(?=[A-Z])|[\s-]+/).some((part) => termMatches(t, part)));
    if (defs.length) { score += Math.min(3, defs.length) * w.def * idfW; hits.push(`defines ${defs.slice(0, 2).map((s) => s.name).join(", ")}`); }
    const tf = f.terms.get(t) ?? 0;
    if (tf) score += Math.log1p(tf) * w.tf * idfW;
  }
  return { score, hits: [...new Set(hits)] };
}

/** edges: from → (to → weight). Rank flows from users to definitions. Dangling mass returns to the seed. */
export function personalizedPageRank(nodes: readonly string[], edges: ReadonlyMap<string, ReadonlyMap<string, number>>, seed: ReadonlyMap<string, number>, o = { damping: 0.85, iterations: 20 }): Map<string, number> {
  const total = nodes.reduce((a, n) => a + (seed.get(n) ?? 0), 0);
  const p = new Map(nodes.map((n) => [n, total > 0 ? (seed.get(n) ?? 0) / total : 1 / nodes.length]));
  let r = new Map(p);
  for (let it = 0; it < o.iterations; it++) {
    const next = new Map(nodes.map((n) => [n, (1 - o.damping) * p.get(n)!]));
    let dangling = 0;
    for (const n of nodes) {
      const outs = edges.get(n), rn = r.get(n)!;
      const sum = outs ? [...outs.values()].reduce((a, b) => a + b, 0) : 0;
      if (!sum) { dangling += rn; continue; }
      for (const [to, w] of outs!) next.set(to, next.get(to)! + o.damping * rn * (w / sum));
    }
    for (const n of nodes) next.set(n, next.get(n)! + o.damping * dangling * p.get(n)!);
    r = next;
  }
  return r;
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]{2,}/g;
const splitIdent = (raw: string): string[] => raw.split(/_|(?=[A-Z])/).filter((p) => p.length >= 2);

/** One file → its index entry: symbols, stemmed term counts, and the raw identifiers it uses (graph edges). */
export function indexFile(path: string, text: string): FileEntry {
  const terms = new Map<string, number>();
  const uses = new Set<string>();
  for (const m of text.matchAll(IDENT)) {
    const raw = m[0];
    for (const part of splitIdent(raw)) {
      const t = stem(part.toLowerCase());
      if (t.length >= 3 && !STOP.has(t)) terms.set(t, (terms.get(t) ?? 0) + 1);
    }
    if (raw.length >= 4) uses.add(raw);
  }
  return { path, text, tokens: estimateTokens(text), syms: extractSymbols(path, text), terms, uses };
}

/** Entries → the index: byPath, defs, users, the "uses a symbol defined in" graph, and idf. */
export function buildIndex(files: FileEntry[]): RepoIndex {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const defs: RepoIndex["defs"] = new Map();
  for (const f of files) for (const s of f.syms) {
    const l = defs.get(s.name) ?? [];
    l.push({ path: f.path, line: s.line, sig: s.sig });
    defs.set(s.name, l);
  }
  const users: RepoIndex["users"] = new Map();
  const graph: RepoIndex["graph"] = new Map();
  for (const f of files) for (const name of f.uses) {
    const definedIn = defs.get(name);
    if (!definedIn || definedIn.length > MAX_DEFINERS) continue;
    for (const g of definedIn) {
      if (g.path === f.path) continue;
      const outs = graph.get(f.path) ?? new Map<string, number>();
      outs.set(g.path, (outs.get(g.path) ?? 0) + 1);
      graph.set(f.path, outs);
      const us = users.get(name) ?? new Set<string>();
      us.add(f.path);
      users.set(name, us);
    }
  }
  // stem siblings: files whose basename stems share a part are the same module in different clothes
  // (cli.py ↔ docs/cli.rst ↔ tests/test_cli.py) — weak mutual edges, and a stem part shared by > 8 files is noise
  const stemParts = new Map<string, Set<string>>();
  for (const f of files) {
    const stemName = f.path.split("/").pop()!.replace(/\.[^.]+$/, "");
    stemParts.set(f.path, new Set(splitIdent(stemName).map((p) => stem(p.toLowerCase())).filter((p) => p.length >= 3 && !STOP.has(p))));
  }
  const byStemPart = new Map<string, Set<string>>();
  for (const [p, parts] of stemParts) for (const part of parts) {
    const group = byStemPart.get(part) ?? new Set<string>();
    group.add(p);
    byStemPart.set(part, group);
  }
  // a docs page that names a symbol is related to that symbol's file in both directions — code is written
  // about it, and it documents the code — so its uses-edges become mutual at half weight. Docs pages donate
  // less rank than they would as plain sources (they explain; they don't depend).
  const isDoc = (p: string) => /\.(rst|md|txt)$/.test(p);
  for (const [src, outs] of graph) if (isDoc(src)) {
    for (const [to, w] of outs) {
      const back = graph.get(to) ?? new Map<string, number>();
      back.set(src, Math.max(back.get(src) ?? 0, w * 0.5));
      graph.set(to, back);
    }
  }
  for (const group of byStemPart.values()) {
    if (group.size > 8) continue;
    for (const a of group) for (const b of group) {
      if (a === b) continue;
      const outs = graph.get(a) ?? new Map<string, number>();
      outs.set(b, (outs.get(b) ?? 0) + 1.0);
      graph.set(a, outs);
    }
  }
  // df(t) = files whose path, symbols or terms match t; idf(t) = log(1 + N / (1 + df(t)))
  const df = new Map<string, number>();
  for (const f of files) {
    const hit = new Set(f.terms.keys());
    for (const seg of f.path.split(/[^A-Za-z0-9]+/)) hit.add(stem(seg.toLowerCase()));
    for (const s of f.syms) for (const part of splitIdent(s.name)) hit.add(stem(part.toLowerCase()));
    for (const t of hit) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = files.length;
  const idf = new Map([...df].map(([t, c]) => [t, Math.log(1 + n / (1 + c))]));
  return { files, byPath, defs, users, graph, idf };
}

export function rankFiles(ix: RepoIndex, q: RankQuery, o: { lex?: LexWeights; damping?: number } = {}): Ranked[] {
  const terms = queryTerms(q.text);                                  // lowercase, split camel/snake, stem, drop stopwords
  const lex = new Map(ix.files.map((f) => [f.path, lexicalScore(f, terms, ix.idf, o.lex)]));          // { score, hits }
  const byScore = (m: Map<string, number>) => [...m].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, CHANNEL_DEPTH).map(([p]) => p);
  const lexical = byScore(new Map([...lex].map(([p, v]) => [p, v.score])));
  const seed = new Map(ix.files.map((f) => [f.path, (lex.get(f.path)?.score ?? 0) + (q.mentioned.includes(f.path) ? 10 : 0) + (q.active === f.path ? 3 : 0)]));
  const graph = [...seed.values()].some((v) => v > 0) ? byScore(personalizedPageRank(ix.files.map((f) => f.path), ix.graph, seed, { damping: o.damping ?? 0.85, iterations: 20 })) : [];   // no seed → no graph channel
  const grep = q.grepHits ? byScore(q.grepHits) : [];                // filled by the extension under the latency budget; may be absent
  const recent = [...new Set([q.active, ...q.recent].filter((p): p is string => !!p && ix.byPath.has(p)))];
  const lists: Record<Channel, string[]> = { lexical, graph, grep, recent };
  return rrfMerge(CHANNELS.map((c) => lists[c])).map((f) => {
    const ranks = Object.fromEntries(CHANNELS.map((c, i) => [c, f.ranks[i]!])) as Record<Channel, number>;
    return { path: f.id, score: f.score, ranks, why: reasons(ix.byPath.get(f.id)!, lex.get(f.id)!, ranks, q, ix, terms, lex) };
  });
}

/** Up to 3 specific reasons, most specific first, then the ranks line of the channels where the file appears. */
function reasons(f: FileEntry, lex: { score: number; hits: string[] }, ranks: Record<Channel, number>, q: RankQuery, ix: RepoIndex, terms: readonly string[], lexAll: ReadonlyMap<string, { score: number; hits: string[] }>): string[] {
  const out: string[] = [];
  if (q.mentioned.includes(f.path)) out.push("mentioned by you");
  for (const h of lex.hits) { if (out.length < 3) out.push(h); }
  if (out.length < 3) {
    let usedBy = 0;
    for (const [src, outs] of ix.graph) if (outs.has(f.path) && (lexAll.get(src)?.score ?? 0) > 0) usedBy++;
    if (usedBy) out.push(`used by ${usedBy} matching file${usedBy === 1 ? "" : "s"}`);
  }
  const hits = q.grepHits?.get(f.path);
  if (out.length < 3 && hits) out.push(`${hits} grep hits for "${terms.find((t) => f.terms.has(t)) ?? terms[0] ?? "the query"}"`);
  if (out.length < 3 && q.active === f.path) out.push("open in editor");
  else if (out.length < 3 && q.recent.includes(f.path)) out.push("changed in this session");
  const ranked = CHANNELS.filter((c) => ranks[c] > 0).map((c) => `${c} #${ranks[c]}`);
  if (ranked.length) out.push(ranked.join(" · "));
  return out;
}

/** The n request terms with the highest idf. A term absent from the index is the rarest (df 0). */
export function rarestTerms(ix: RepoIndex, text: string, n: number): string[] {
  const max = Math.log(1 + ix.files.length + 1);
  return queryTerms(text).sort((a, b) => (ix.idf.get(b) ?? max) - (ix.idf.get(a) ?? max)).slice(0, n);
}

/** The n request terms the grep channel searches: terms that name a path segment first (the user names
 * modules and files, not prose), by idf; then the remaining index-present terms, then the absent ones. */
export function grepTerms(ix: RepoIndex, text: string, n: number): string[] {
  const segs = new Set<string>();
  for (const f of ix.files) for (const s of f.path.split(/[^A-Za-z0-9]+/)) segs.add(stem(s.toLowerCase()));
  const rare = rarestTerms(ix, text, queryTerms(text).length);
  const present = rare.filter((t) => ix.idf.has(t));
  const named = present.filter((t) => segs.has(t));
  const rest = present.filter((t) => !segs.has(t));
  return [...named, ...rest, ...rare.filter((t) => !ix.idf.has(t))].slice(0, n);
}
