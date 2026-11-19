---
trigger: always_on
description: Context assembly - the symbol index, personalized-PageRank repo map, the token-budgeted context pack with reasons, @file/@symbol mentions, and per-tool output budgets
---

# Context assembly (B1, 15 points: the largest criterion)

The judge must **see** which files were chosen, why, and against what budget, during Task B. Three surfaces show it:

1. **The context pack card** at the top of each agent turn, with one row per file: `path · tokens · why`. The bar
   reads `used / budget`.
2. **The lead's first message**, which must start with "Plan" and list "Files: path — why" (rule 50).
3. **The review header** of every proposal, which shows `why` (a required `propose_edit` argument).

## Strategy (this paragraph goes into the write-up, section 4)

> co4fe3 keeps a symbol index of the workspace (definitions, docstring first lines, identifiers), built in the
> background and updated on save. For each request it ranks files by **personalized PageRank** over a "uses a symbol
> defined in" graph. Seeds come from lexical matches of the request's terms in paths, symbol names and docstrings,
> files mentioned with @, and the active editor. It then packs the top files as **outlines** (signatures with line
> numbers) greedily into a fixed budget (6,000 tokens by default). Mentioned files and symbols are pinned first.
> Every packed file carries the reasons it was chosen. Everything else stays out of the prompt: the agent pulls more
> through `repo_map`, `search_workspace`, `find_symbol` and windowed `read_file`, each with its own output cap. Token
> counts are computed by code, never by the model.

## Budgets (constants in `agent-core/src/context/budget.ts`; settings can lower them, never raise above the cap)

| Thing | Default | Cap | Why |
|---|---|---|---|
| Context pack (agent turn) | 6,000 tok | 12,000 | Weak models degrade on long prompts, and TTFT grows with input tokens |
| First user message in total | 12,000 tok | 20,000 | instructions + pack + request |
| Inline edit context | 3,000 tok | 6,000 | selection + 40 lines around it + the file outline |
| `read_file` per call | 400 lines | 800 | the model pages with `offset` |
| `search_workspace` | 50 hits | 200 | each hit cut to 200 chars |
| `repo_map` | 2,500 tok | 4,000 | same format as the pack |
| `run_command` output to the model | 16 KB | 16 KB | the first 2 KB plus the last 14 KB |

Compaction (TrueForge) is the backstop, not the plan. Both agent definitions set
`contextManagement.compaction.trigger = { type: "input_tokens", value: 0.6 × the model's context length }`.

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

## Ranking (`context/repomap.ts`)

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
export interface RankQuery { text: string; mentioned: string[]; active?: string }
export interface Ranked { path: string; score: number; why: string[] }

export function rankFiles(ix: RepoIndex, q: RankQuery): Ranked[] {
  const terms = queryTerms(q.text);                                  // lowercase, split camel/snake, stem, drop stopwords
  const lex = new Map(ix.files.map((f) => [f.path, lexicalScore(f, terms, ix.idf)]));          // { score, hits }
  const lexScore = new Map([...lex].map(([p, v]) => [p, v.score]));
  const seed = new Map(ix.files.map((f) => [f.path, (lexScore.get(f.path) ?? 0) + (q.mentioned.includes(f.path) ? 10 : 0) + (q.active === f.path ? 3 : 0)]));
  const pr = personalizedPageRank(ix.files.map((f) => f.path), ix.graph, seed, { damping: 0.85, iterations: 20 });  // workflow 06
  return ix.files
    .map((f) => ({ path: f.path, score: 0.6 * norm(pr, f.path) + 0.4 * norm(lexScore, f.path), why: reasons(f, lex.get(f.path)!, q, ix) }))   // norm = value / max value
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));        // deterministic tie-break
}
```

The rules for `reasons()` (at most 3, most specific first):

- `mentioned by you`
- `path matches "cli"`
- `defines routes_command, shell_command`
- `used by 6 matching files`
- `open in editor`

Names defined in more than 5 files, or shorter than 4 characters, add no graph edges. They are noise (`app`, `run`,
`get`).

## The pack (`context/pack.ts`)

```ts
export interface PackItem { path: string; why: string[]; tokens: number; text: string; pinned: boolean; mode: "outline" | "full" | "slice" }
export interface ContextPack { items: PackItem[]; used: number; budget: number; skipped: { path: string; why: string }[] }

export function assemblePack(ix: RepoIndex, ranked: Ranked[], pins: Pin[], budget: number): ContextPack {
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

**Invariant (property test): `pack.used <= pack.budget` and `used === Σ items.tokens` for any index and any budget.**

Rendered into the first user message (and shown verbatim in the pack card's "view as sent"):

```
<context_pack budget="6000" used="5820">
## src/flask/cli.py — path matches "cli"; defines routes_command, shell_command; used by 6 matching files
L512  class FlaskGroup(AppGroup):
L533      def __init__(self, add_default_commands: bool = True, …)
L1020 @click.command("routes", short_help="Show the routes for the app.")
…
</context_pack>
The pack is a map, not the files. Read a file with read_file before editing it.
```

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
- On save and after every applied checkpoint, only that file is re-indexed.
- Until the index is ready, a turn waits up to 1.5 s for it, then sends without a pack and says so in the pack card.
