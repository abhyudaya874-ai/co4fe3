---
description: Build the symbol index, four ranked channels fused with RRF, the budgeted context pack with per-channel ranks and a latency budget, @mentions, repo_map / find_symbol / pack_context (LSP-backed), and the pack card - then prove the ranking on flask for Task B
argument-hint: ""
---

# 06 Context (B1, 15 points)

Goal: for the Task B request on flask, the pack card lists `src/flask/cli.py`, `tests/test_cli.py` and
`docs/cli.rst` in its top 5, each with reasons and per-channel ranks, at `used ≤ 6000 / 6000` tokens. The same ranking
also backs the `repo_map` tool. `pack_context` answers for any symbol, with or without a language server. Implement
rule 40 (its shape follows V3Code's retrieval, `docs/study/v3code.md` §12–§13); the pieces rule 40 leaves out are
below.

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

## 5. The grep channel and the budget (`context/indexer.ts`, rule 40)

```ts
async packFor(text: string, active?: string, recent: string[] = []): Promise<ContextPack> {
  const full = async () => {
    const ix = await this.ready();                                   // resolves when the first build is done
    const grepHits = new Map<string, number>();
    const ac = new AbortController();
    for (const term of rarestTerms(ix, text, 3)) {                   // the 3 request terms with the highest idf
      for (const h of await this.host.search({ pattern: term, maxHits: 200 }, ac.signal)) grepHits.set(h.path, (grepHits.get(h.path) ?? 0) + 1);
    }
    const { pins } = parseMentions(text, ix);
    return { ...assemblePack(ix, rankFiles(ix, { text, mentioned: pins.map((p) => p.path), active, recent, grepHits }), pins, this.budget()), path: "full" as const };
  };
  const quick = async () => {
    const ix = this.get(); if (!ix) throw new Error("no index");
    return { ...assemblePack(ix, rankFiles(ix, { text, mentioned: [], active, recent }), [], this.budget()), path: "quick" as const };   // no grep, no wait
  };
  const r = await withinBudget(full, quick, { ...EMPTY_PACK, path: "none" as const }, { fullMs: BUDGET.retrieveFullMs, quickMs: BUDGET.retrieveQuickMs });
  this.out.info(`perf agent.pack path=${r.path} items=${r.value.items.length} used=${r.value.used}`);
  return r.value;
}
```

`recent` is the open editors plus the paths in this session's checkpoint log, newest first.

## 6. The pack card (webview `PackCard.tsx`)

The header reads `Context · 7 files · 5,820 / 6,000 tokens`, with a bar, and a small tag when the quick path or no
path ran ("quick pack: index still building"). Each row shows:

- the path and its tokens;
- its reasons;
- a ranks line: `lexical #1 · graph #2 · grep #1`, as small chips. This is the visible proof of the fusion.

Clicking a row opens the file. The footer reads `+3 more ranked files were left out (over budget)` and has a
**View as sent** button that shows `renderPack()` verbatim. This card is the B1 evidence; make it legible at the 1080p
recording size.

## 7. `pack_context` on the extension side (`host/lsp.ts`)

```ts
export function createLspHost(root: string): LspHost {
  const uri = (rel: string) => vscode.Uri.file(path.join(root, rel));
  const relOf = (u: vscode.Uri) => { const r = path.relative(root, u.fsPath).split(path.sep).join("/"); return r.startsWith("..") ? null : r; };
  const pos = (line: number, col: number) => new vscode.Position(line, col);
  const quiet = async <T>(p: Thenable<T | undefined>, ms = 1500): Promise<T | undefined> => Promise.race([Promise.resolve(p).catch(() => undefined), new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);
  return {
    async documentSymbols(rel) {
      const res = await quiet(vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>("vscode.executeDocumentSymbolProvider", uri(rel)));
      return flattenSymbols(res ?? []);                            // DocumentSymbol tree → LspSymbol[] with parent names; SymbolInformation → its location range
    },
    async references(rel, line, col) {
      const res = await quiet(vscode.commands.executeCommand<vscode.Location[]>("vscode.executeReferenceProvider", uri(rel), pos(line, col)));
      return (res ?? []).flatMap((l) => { const r = relOf(l.uri); return r ? [{ path: r, line: l.range.start.line }] : []; });
    },
    async incomingCalls(rel, line, col) {
      const items = await quiet(vscode.commands.executeCommand<vscode.CallHierarchyItem[]>("vscode.prepareCallHierarchy", uri(rel), pos(line, col)));
      if (!items?.[0]) return [];
      const calls = await quiet(vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>("vscode.provideIncomingCalls", items[0]));
      return (calls ?? []).flatMap((c) => { const r = relOf(c.from.uri); return r ? [{ from: c.from.name, path: r, line: c.from.selectionRange.start.line }] : []; });
    },
    async hover(rel, line, col) {
      const hs = await quiet(vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", uri(rel), pos(line, col)));
      return (hs ?? []).flatMap((h) => h.contents.map((c) => (typeof c === "string" ? c : "value" in c ? c.value : "")));
    },
  };
}
```

The command names and return types come from code.visualstudio.com/api/references/commands (verified 19 Nov 2026).
Read `@types/vscode` for `DocumentSymbol`, `CallHierarchyItem` and `Hover.contents` before you change anything here.
Every call has a 1.5 s ceiling (`quiet`), because a slow language server must not stall the agent. An empty answer
makes `pack_context` fall back to the index (`source: "index"`).

Check in the Extension Development Host on flask, with the Python extension installed:

- `pack_context { path: "src/flask/cli.py", symbol: "FlaskGroup", task: "extend" }` returns the definition, callers
  and `source: lsp`;
- with the Python extension disabled, the same call returns `source: index`.

Paste both into `docs/progress/06-context.md`.

## 8. Prove it on flask

Register `co4fe3.dev.rank` (development mode only). It prints `rankFiles()` for a prompt into the output channel,
with each file's per-channel ranks.

```
co4fe3: Dev: Rank files for prompt → paste the Task B instruction
```

Paste the top 10, with reasons and ranks, into `docs/progress/06-context.md`. If cli.py, test_cli.py or docs/cli.rst
is not in the top 5, tune in this order and re-run the `repomap.test.ts` fixture case after each change:

1. the lexical weights (path ×3, defs ×2, tf);
2. the PageRank damping;
3. the number of grep terms.

Keep RRF's `k = 60`: V3Code's note says not to change it without evidence. Never special-case flask, file names or
this prompt: judges may use another repo.

## Exit check

- Unit:
  - `tokens`;
  - `symbols` (Python defs, classes, click commands, docstring first lines);
  - `rrf`;
  - `repomap` (the minipkg ranking case, PageRank on a 4-node graph, deterministic ties, a missing channel);
  - `budget` (`withinBudget`);
  - `pack` (the budget property);
  - `symbolPack`;
  - `mentions`.
- Perf: index of a generated 400-file repo < 3 s, `rankFiles` with 4 channels < 100 ms, `assemblePack` < 160 ms,
  `shapeSymbolPack` < 20 ms (2× the budgets).
- The flask ranking is recorded and meets the goal. The pack card shows ranks during a real Task B run.
- `pack_context` works with and without the language server (step 7).
- Commit: `context: four-channel RRF ranking, budgeted pack with ranks, LSP-backed pack_context`
