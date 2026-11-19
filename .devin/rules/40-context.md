---
trigger: always_on
description: Context assembly - the symbol index, four ranked channels fused with Reciprocal Rank Fusion, the token-budgeted context pack with per-channel reasons, a retrieval latency budget with a lexical fallback, the LSP-backed pack_context tool, @mentions, and truncation that says what to do next
---

# Context assembly (B1, 15 points: the largest criterion)

The judge must **see** which files were chosen, why, and against what budget, during Task B. Three surfaces show it:

1. **The context pack card** at the top of each agent turn, with one row per file: `path · tokens · why`. The bar
   reads `used / budget`, and each row shows its rank in every channel (`lexical #1 · graph #3 · grep #2`).
2. **The lead's first message**, which must start with "Plan" and list "Files: path — why" (rule 50).
3. **The review header** of every proposal, which shows `why` (a required `propose_edit` argument).

The structure follows V3Code's retrieval (`docs/study/v3code.md` §12–§13):

- several cheap ranked channels, fused with Reciprocal Rank Fusion (RRF), where a missing channel is fine;
- a hard latency budget with a lexical fallback;
- an LSP-backed bundle per symbol, under a token budget, with a fixed trim order.

V3Code's channels need embedding models and a Rust sidecar. Ours need neither.

## Strategy (this paragraph goes into the write-up, section 4)

> co4fe3 keeps a symbol index of the workspace (definitions, docstring first lines, identifiers), built in the
> background and updated on save. For each request it ranks files in four independent channels:
> - **lexical**: request terms in paths, symbol names and docstrings, IDF-weighted;
> - **graph**: personalized PageRank over a "uses a symbol defined in" graph, seeded by the lexical hits, @-mentions
>   and the active editor;
> - **grep**: ripgrep hits for the rarest request terms;
> - **recent**: open editors and files changed in this session.
>
> The four lists are fused with **Reciprocal Rank Fusion** (k = 60), as in V3Code. A file's per-channel ranks are
> its explanation. The top files are packed as **outlines** (signatures with line numbers) into a fixed budget (6,000
> tokens by default), with @-mentioned files and symbols pinned first. Retrieval has a hard latency budget: if the
> full ranking misses 800 ms, a lexical-only pack is used, and if that misses 200 ms the turn goes out without one.
> Everything else stays out of the prompt. The agent pulls more through `repo_map`, `search_workspace`,
> `find_symbol`, the LSP-backed `pack_context` (definition, callers, references and diagnostics for one symbol,
> trimmed to a budget in a fixed order), and windowed `read_file`. Each has its own output cap, and every truncation
> says how to get the rest. Token counts are computed by code, never by the model.

## Budgets (constants in `agent-core/src/context/budget.ts`; settings can lower them, never raise above the cap)

| Thing | Default | Cap | Why |
|---|---|---|---|
| Context pack (agent turn) | 6,000 tok | 12,000 | Weak models degrade on long prompts, and TTFT grows with input tokens |
| First user message in total | 12,000 tok | 20,000 | instructions + pack + request |
| Inline edit context | 3,000 tok | 6,000 | selection + 40 lines around it + the file outline + up to 12 problems |
| Retrieval latency (full / quick) | 800 / 200 ms | — | never block the first token on retrieval (V3Code: 3,000 / 500 ms with embeddings) |
| `read_file` per call | 400 lines | 800 | the model pages with `offset` |
| `search_workspace` | 50 hits | 200 | each hit cut to 200 chars |
| `repo_map` | 2,500 tok | 4,000 | same format as the pack |
| `pack_context` | 3,000 tok | 6,000 | V3Code's default `max_tokens` |
| `run_command` output to the model | 16 KB | 16 KB | the first 2 KB plus the last 14 KB |
| Any MCP tool result (last line of defence in `wrap()`) | 60,000 chars | 60,000 | ≈ 15k tokens, V3Code's `boundMcpText` ceiling |

Compaction (TrueForge) is the backstop, not the plan. Both agent definitions set
`contextManagement.compaction.trigger = { type: "input_tokens", value: 0.6 × the model's context length }`.

## Truncation always says what to do next (`util/truncate.ts`)

```ts
/** Cuts `text` to `max` chars on a line boundary and appends a note naming what was cut and how to get it. */
export function truncateWithHint(text: string, max: number, hint: string): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf("\n", max);
  const kept = text.slice(0, cut > max * 0.5 ? cut : max);
  return `${kept}\n…(truncated: ${text.length - kept.length} more characters. ${hint})`;
}
// read_file:        hint "Call read_file with offset=<next line> for the rest."
// search_workspace: hint "Narrow the pattern or add a glob."
// run_command:      the head+tail cut keeps both ends and says "middle <n> lines omitted"
// wrap():           truncateWithHint(text, 60_000, "Ask for a smaller range.")
```

Test: the note names the right number of characters, and text under the limit is returned unchanged (same object).

## Token estimate (`context/tokens.ts`). The same estimator everywhere, tested against known strings.

```ts
/** chars per token falls as punctuation rises (code ≈ 3, prose ≈ 4.3); non-ASCII costs ~0.7 token per char. */
export function estimateTokens(s: string): number {
  let ascii = 0, punct = 0, other = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 128) { other++; continue; }
    ascii++;
    const word = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 32 || c === 10 || c === 9 || c === 13;
    if (!word) punct++;
  }
  const perTok = Math.max(2.8, 4.3 - 3.2 * (ascii ? punct / ascii : 0));
  return Math.ceil(ascii / perTok + other * 0.7);
}
```

## Symbols (`context/symbols.ts`). Regex and indentation, no tree-sitter (decision D7).

The language server is the first choice for symbols (`pack_context`). This regex index is what we have when no
server answers, and it is what the ranking runs on, because it is instant and works offline.

```ts
export interface Sym { name: string; kind: "class" | "def" | "function" | "command" | "const"; line: number; sig: string; parent?: string; doc?: string }

const PY_DEF = /^(\s*)(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)\s*(\([^)]*\)?[^:]*)?:/;
const PY_CMD = /^\s*@[\w.]+\.command\(\s*["']([\w-]+)["']/;     // click: @click.command("routes") → a "command" symbol
const TS_DEF = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|const|interface|type)\s+([A-Za-z_$][\w$]*)/;

export function extractSymbols(path: string, text: string): Sym[] {
  const lines = text.split("\n");
  const out: Sym[] = [];
  const stack: { indent: number; name: string }[] = [];
  lines.forEach((raw, i) => {
    if (path.endsWith(".py")) {
      const cmd = PY_CMD.exec(raw);
      if (cmd) out.push({ name: cmd[1]!, kind: "command", line: i + 1, sig: raw.trim() });
      const m = PY_DEF.exec(raw);
      if (!m) return;
      const indent = m[1]!.length;
      while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
      const doc = /^\s*[rub]?("""|''')(.*)/.exec(lines[i + 1] ?? "")?.[2]?.replace(/("""|''')\s*$/, "").trim();
      out.push({ name: m[3]!, kind: m[2] === "class" ? "class" : "def", line: i + 1, sig: raw.trim().slice(0, 160), parent: stack.at(-1)?.name, doc: doc || undefined });
      if (m[2] === "class") stack.push({ indent, name: m[3]! });
    } else if (/\.(m?[jt]sx?)$/.test(path)) {
      const m = TS_DEF.exec(raw);
      if (m) out.push({ name: m[2]!, kind: m[1] === "class" ? "class" : m[1] === "function" ? "function" : "const", line: i + 1, sig: raw.trim().slice(0, 160) });
    }
  });
  return out;
}
```

## Reciprocal Rank Fusion (`context/rrf.ts`). Pure, about 20 lines, our own code.

Formula (Cormack, Clarke & Büttcher, SIGIR 2009; V3Code `semanticIndex/rrf.ts` uses the same): `score(d) =
Σ_channels 1 / (k + rank_c(d))`, with ranks starting at 1 and `k = 60`. The `k` damps the head of each list, so a
file ranked 1st in one channel and 50th in another beats a file that appears only once, at 1st.

```ts
export interface Fused { id: string; score: number; ranks: number[] }   // ranks[c] = 1-based rank in channel c, 0 = absent
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
```

Tests (`rrf.test.ts`):

- 1st + 50th beats a single 1st;
- an empty channel changes nothing;
- duplicates within a channel are ignored;
- ties sort by id;
- `k <= 0` throws;
- each item's `ranks` array is correct.

## Ranking (`context/repomap.ts`): four channels, then RRF

```ts
export interface FileEntry { path: string; tokens: number; syms: Sym[]; terms: Map<string, number>; uses: Set<string> }  // see workflow 06
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

export function rankFiles(ix: RepoIndex, q: RankQuery): Ranked[] {
  const terms = queryTerms(q.text);                                  // lowercase, split camel/snake, stem, drop stopwords
  const lex = new Map(ix.files.map((f) => [f.path, lexicalScore(f, terms, ix.idf)]));          // { score, hits }
  const byScore = (m: Map<string, number>) => [...m].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, CHANNEL_DEPTH).map(([p]) => p);
  const lexical = byScore(new Map([...lex].map(([p, v]) => [p, v.score])));
  const seed = new Map(ix.files.map((f) => [f.path, (lex.get(f.path)?.score ?? 0) + (q.mentioned.includes(f.path) ? 10 : 0) + (q.active === f.path ? 3 : 0)]));
  const graph = [...seed.values()].some((v) => v > 0) ? byScore(personalizedPageRank(ix.files.map((f) => f.path), ix.graph, seed)) : [];   // no seed → no graph channel
  const grep = q.grepHits ? byScore(q.grepHits) : [];                // filled by the extension under the latency budget; may be absent
  const recent = [...new Set([q.active, ...q.recent].filter((p): p is string => !!p && ix.byPath.has(p)))];
  const lists: Record<Channel, string[]> = { lexical, graph, grep, recent };
  return rrfMerge(CHANNELS.map((c) => lists[c])).map((f) => {
    const ranks = Object.fromEntries(CHANNELS.map((c, i) => [c, f.ranks[i]!])) as Record<Channel, number>;
    return { path: f.id, score: f.score, ranks, why: reasons(ix.byPath.get(f.id)!, lex.get(f.id)!, ranks, q, ix) };
  });
}
```

The rules for `reasons()`: at most 3 specific reasons, then one ranks line.

- Specific, most specific first:
  - `mentioned by you`
  - `path matches "cli"`
  - `defines routes_command, shell_command`
  - `used by 6 matching files`
  - `14 grep hits for "config"`
  - `open in editor` / `changed in this session`
- Ranks line, only channels where the file appears: `lexical #1 · graph #3 · grep #2`.

Names defined in more than 5 files, or shorter than 4 characters, add no graph edges. They are noise (`app`, `run`,
`get`).

Tests (`repomap.test.ts`):

- on minipkg, the Task-B-like query ranks `cli.py`, `tests/test_cli.py` and `docs/cli.rst` in the top 5;
- the ranking is deterministic;
- a missing grep channel still ranks;
- an empty query with an active file still returns the active file first.

## The retrieval budget (`context/budget.ts`, after V3Code's `retrieveWithinChatBudget`)

```ts
/** Runs `full` under `fullMs`, then `quick` under `quickMs`, then gives `fallback`. Never rejects: a missing pack is "skip", not an error. */
export async function withinBudget<T>(full: () => Promise<T>, quick: () => Promise<T>, fallback: T, o: { fullMs: number; quickMs: number; timer?: Timer }): Promise<{ value: T; path: "full" | "quick" | "none" }> {
  const race = (p: Promise<T>, ms: number) => new Promise<T | undefined>((res) => { const t = (o.timer ?? realTimer).set(() => res(undefined), ms); p.then((v) => { (o.timer ?? realTimer).clear(t); res(v); }, () => res(undefined)); });
  const a = await race(full(), o.fullMs);
  if (a !== undefined) return { value: a, path: "full" };
  const b = await race(quick(), o.quickMs);                         // quick is only started when full missed: no double work when warm
  return b !== undefined ? { value: b, path: "quick" } : { value: fallback, path: "none" };
}
```

The extension calls it as `withinBudget(() => fullPack(text), () => lexicalPack(text), EMPTY_PACK, { fullMs: 800,
quickMs: 200 })`:

- `fullPack` waits for the index, runs `rg` for the 3 rarest request terms (`maxHits` 200), ranks and packs.
- `lexicalPack` uses the paths and the symbol index only.

The pack card says which path ran ("Context · quick pack (index still building)"). Tests (`budget.test.ts`, fake
timer):

- full in time → `"full"` and quick is never called;
- full late → quick;
- both late → `"none"`;
- full throws → quick.

## The pack (`context/pack.ts`)

```ts
export interface PackItem { path: string; why: string[]; tokens: number; text: string; pinned: boolean; mode: "outline" | "full" | "slice" }
export interface ContextPack { items: PackItem[]; used: number; budget: number; skipped: { path: string; why: string }[]; path: "full" | "quick" | "none" }

export function assemblePack(ix: RepoIndex, ranked: Ranked[], pins: Pin[], budget: number): Omit<ContextPack, "path"> {
  const items: PackItem[] = [];
  let used = 0;
  const add = (it: PackItem) => { if (used + it.tokens <= budget) { items.push(it); used += it.tokens; return true; } return false; };
  for (const p of pins) add(p.kind === "symbol" ? sliceItem(ix, p) : fileItem(ix, p.path, "full", ["mentioned by you"], true)) || add(fileItem(ix, p.path, "outline", ["mentioned by you (outline: too large for full text)"], true));
  const skipped: ContextPack["skipped"] = [];
  for (const r of ranked) {
    if (items.some((i) => i.path === r.path)) continue;
    if (!add(fileItem(ix, r.path, "outline", r.why, false))) skipped.push({ path: r.path, why: "over budget" });
    if (items.length >= 12) break;
  }
  return { items, used, budget, skipped: skipped.slice(0, 5) };
}
```

A `slice` (a mentioned symbol) is the symbol's lines. When it has no clear end, use an 80-line window with a 10-line
overlap (V3Code's chunker fallback).

**Invariant (property test): `pack.used <= pack.budget` and `used === Σ items.tokens` for any index and any budget.**

Rendered into the first user message (and shown verbatim in the pack card's "view as sent"):

```
<context_pack budget="6000" used="5820">
## src/flask/cli.py — path matches "cli"; defines routes_command, shell_command; lexical #1 · graph #2 · grep #1
L512  class FlaskGroup(AppGroup):
L533      def __init__(self, add_default_commands: bool = True, …)
L1020 @click.command("routes", short_help="Show the routes for the app.")
…
</context_pack>
The pack is a map, not the files. Read a file with read_file (or pack_context for one symbol) before editing it.
```

## `pack_context`: one budgeted bundle per symbol (`context/symbolPack.ts`, after V3Code's Context Bridge)

Arguments: `path, symbol, task: "understand" | "refactor" | "debug" | "extend" = "understand", max_tokens = 3000`.

The tool description starts with "WHEN: you know the file and the symbol and are about to work on it — use this
instead of several read_file and search calls."

The extension gathers raw facts through `EditorHost.lsp` and `problems()`. The pure function decides what fits:

```ts
export type PackTask = "understand" | "refactor" | "debug" | "extend";
/** V3Code's per-task caps (credited design parameters): callers, references, lines of context per caller. */
export const TASK_CAPS: Record<PackTask, { callers: number; references: number; callerLines: number }> = {
  understand: { callers: 3, references: 4, callerLines: 8 },
  refactor: { callers: 10, references: 8, callerLines: 4 },
  debug: { callers: 6, references: 4, callerLines: 6 },
  extend: { callers: 4, references: 2, callerLines: 4 },
};
export interface SymbolFacts {
  symbol: { name: string; path: string; line: number; endLine: number };
  definition: string; signature: string; problems: Problem[];
  callers: { from: string; path: string; line: number; snippet: string[] }[];
  references: { path: string; line: number; snippet: string[] }[];
  source: "lsp" | "index";                                            // "index" = no language server answered; built from symbols.ts + rg
}
export interface SymbolPack extends SymbolFacts { task: PackTask; tokens: number; dropped: { references: number; callerSnippets: number; callers: number } }

/** Trim order, as in V3Code: references, then caller snippets, then callers. The definition is cut at 2 × budget chars with a note. */
export function shapeSymbolPack(f: SymbolFacts, task: PackTask, maxTokens: number): SymbolPack {
  const caps = TASK_CAPS[task], budget = Math.max(500, maxTokens);
  const p: SymbolPack = { ...f, task, tokens: 0, callers: f.callers.slice(0, caps.callers).map((c) => ({ ...c, snippet: c.snippet.slice(0, caps.callerLines) })), references: f.references.slice(0, caps.references), problems: pickProblems(f.problems), dropped: { references: Math.max(0, f.references.length - caps.references), callerSnippets: 0, callers: Math.max(0, f.callers.length - caps.callers) } };
  if (p.definition.length > budget * 2) p.definition = p.definition.slice(0, budget * 2) + "\n[Definition truncated: ask pack_context for a narrower symbol, or read_file with offset.]";
  const size = () => estimateTokens(renderSymbolPack(p));
  while (size() > budget && p.references.length) { p.references.pop(); p.dropped.references++; }
  for (let i = p.callers.length - 1; size() > budget && i >= 0; i--) if (p.callers[i]!.snippet.length) { p.callers[i]!.snippet = []; p.dropped.callerSnippets++; }
  while (size() > budget && p.callers.length) { p.callers.pop(); p.dropped.callers++; }
  p.tokens = size();
  return p;
}
export function renderSymbolPack(p: SymbolPack): string;   // "## <symbol> (<path>:<line>, from <lsp|index>)" + definition + problems + callers + references + "dropped: …"
```

The extension side is `host/lsp.ts`, built on the built-in commands verified in rule 10's `LspHost`:

1. `documentSymbols(rel)` → find the symbol by name (if several, the one nearest the requested line);
2. `readText` → the definition lines `[line, endLine]`;
3. `hover` → the signature (keep the fenced code, as V3Code's `extractHoverSignature` does);
4. `incomingCalls` → callers;
5. `references` → references;
6. `problems(rel)` → filtered to the symbol's range.

When `documentSymbols` returns nothing (no Python extension installed), the facts come from our index and `rg -w
<name>`, and `source: "index"`. **The tool always answers.** It only gets less precise.

Tests (`symbolPack.test.ts`):

- caps per task;
- the trim order (references go first);
- a 20,000-char definition is cut with the note;
- the output fits `max_tokens` for random facts (property test);
- `source` is passed through.

## Mentions (`context/mentions.ts`)

```ts
export type Pin = { kind: "file"; path: string } | { kind: "symbol"; name: string; path: string; line: number };
/** "@src/flask/cli.py" and "@symbol:FlaskGroup". Unknown mentions come back in `unresolved` and are shown, never dropped silently. */
export function parseMentions(text: string, ix: RepoIndex): { pins: Pin[]; unresolved: string[]; clean: string };
```

The composer autocompletes `@` from the index (files first, then symbols), at most 20 items, filtered as you type.

## Index lifecycle (in the extension, never blocking)

- Activation: `void indexWorkspaceInBackground()` reads files in chunks of 50 and yields with `setImmediate` between
  chunks. It skips binaries, files over 300 KB and anything `jail()` forbids.
- On save and after every applied checkpoint, only that file is re-indexed, and it joins the `recent` channel.
- Files remain the source of truth (V3Code's Beast rule): a hit is re-read from the file before it is packed or
  shown, so a stale index can only cost a rank, never show wrong text.
- Until the index is ready, the retrieval budget picks the quick path or none, and the pack card says so.
