---
description: Build the symbol index, personalized-PageRank ranking, the budgeted context pack with reasons, @mentions, the repo_map and find_symbol tools, and the pack card - then prove the ranking on flask for Task B
argument-hint: ""
---

# 06 Context (B1, 15 points)

Goal: for the Task B request on flask, the pack card lists `src/flask/cli.py`, `tests/test_cli.py` and
`docs/cli.rst` in its top 5, each with reasons, at `used ≤ 6000 / 6000` tokens. The same ranking also backs the
`repo_map` tool. Implement rule 40; the pieces rule 40 leaves out are below.

## 1. Terms and lexical score (`context/repomap.ts`)

```ts
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

// FileEntry and RepoIndex are defined in rule 40 (copy them from there).
// terms: stemmed lowercase identifier parts → count (for scoring); uses: raw identifiers ≥ 4 chars (for graph edges)

export function lexicalScore(f: FileEntry, terms: readonly string[], idf: ReadonlyMap<string, number>): { score: number; hits: string[] } {
  const segs = f.path.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let score = 0; const hits: string[] = [];
  for (const t of terms) {
    const w = idf.get(t) ?? 1;
    if (segs.some((s) => termMatches(t, s))) { score += 3 * w; hits.push(`path matches "${t}"`); }
    const defs = f.syms.filter((s) => s.name.split(/_|(?=[A-Z])/).some((part) => termMatches(t, part)));
    if (defs.length) { score += Math.min(3, defs.length) * 2 * w; hits.push(`defines ${defs.slice(0, 2).map((s) => s.name).join(", ")}`); }
    const tf = f.terms.get(t) ?? 0;
    if (tf) score += Math.log1p(tf) * w;
  }
  return { score, hits: [...new Set(hits)] };
}
// idf(t) = log(1 + N / (1 + df(t))), df = files whose path, symbols or terms match t
```

## 2. Personalized PageRank (`context/repomap.ts`). Deterministic and tested on a 4-node graph.

```ts
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
```

Edges come from `buildIndex()`. For each file F and each name in `F.uses` defined in a file G ≠ F (and defined in
at most 5 files), add `F → G` with weight +1.

## 3. Outlines and rendering (`context/pack.ts`)

```ts
export const outlineOf = (f: FileEntry, max = 40): string =>
  f.syms.slice(0, max).map((s) => `L${s.line}`.padEnd(6) + (s.parent ? "    " : "") + s.sig).join("\n") + (f.syms.length > max ? `\n… ${f.syms.length - max} more symbols` : "");
export function renderPack(p: ContextPack): string {
  if (!p.items.length) return "<context_pack used=\"0\">no index yet: use repo_map and search_workspace</context_pack>";
  return `<context_pack budget="${p.budget}" used="${p.used}">\n${p.items.map((i) => i.text).join("\n\n")}\n</context_pack>\nThe pack is a map, not the files. Read a file with read_file before editing it.`;
}
```

## 4. The index in the extension (`extensions/…/src/context/indexer.ts`): background, chunked, incremental

```ts
export async function indexWorkspaceInBackground(host: EditorHost, store: IndexStore, out: vscode.LogOutputChannel): Promise<void> {
  const t = performance.now();
  const files = (await host.listFiles(5000)).filter((p) => INDEXABLE.test(p));   // .py .ts .tsx .js .mjs .md .rst .toml .cfg .txt
  const entries: FileEntry[] = [];
  for (let i = 0; i < files.length; i += 50) {
    for (const p of files.slice(i, i + 50)) {
      const text = await host.readText(p);
      if (text !== null && text.length <= 300_000) entries.push(indexFile(p, text));
    }
    await new Promise((r) => setImmediate(r));                                      // let the editor breathe
  }
  store.set(buildIndex(entries));
  out.info(`perf index.build ${Math.round(performance.now() - t)}ms files=${entries.length}`);
}
// on save / after an applied checkpoint: store.update(indexFile(path, text)) → rebuild only that file's edges
```

## 5. The pack card (webview `PackCard.tsx`)

The header reads `Context · 7 files · 5,820 / 6,000 tokens`, with a bar. Each row shows the path, its tokens and its
reasons, and clicking a row opens the file. The footer reads `+3 more ranked files were left out (over budget)` and
has a **View as sent** button that shows `renderPack()` verbatim. This card is the B1 evidence; make it legible at
the 1080p recording size.

## 6. Prove it on flask

Register `co4fe3.dev.rank` (development mode only). It prints `rankFiles()` for a prompt into the output channel.

```
co4fe3: Dev: Rank files for prompt → paste the Task B instruction
```

Paste the top 10 with reasons into `docs/progress/06-context.md`. If cli.py, test_cli.py or docs/cli.rst is not in
the top 5, tune the **generic** weights (path ×3, defs ×2, tf, damping, the 0.6/0.4 blend) and re-run the
`repomap.test.ts` fixture case. Never special-case flask, file names or this prompt: judges may use another repo.

## Exit check

- Unit: `tokens`, `symbols` (Python defs, classes, click commands, docstring first lines), `repomap` (the minipkg
  ranking case, PageRank on a 4-node graph, deterministic ties), `pack` (the budget property), `mentions`, green.
- Perf: index of a generated 400-file repo < 3 s, `rankFiles` < 100 ms, `assemblePack` < 160 ms (2× the budgets).
- The flask ranking is recorded and meets the goal. The pack card shows it during a real Task B run.
- Commit: `context: symbol index, personalized PageRank pack with reasons and budget`
