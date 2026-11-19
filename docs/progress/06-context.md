# 06 — context

Symbol index + four-channel RRF retrieval + budgeted pack + `pack_context` over LSP with an index fallback.

## What was built

- `context/rrf.ts` — Reciprocal Rank Fusion, k = 60, deterministic ties by path.
- `context/repomap.ts` — `indexFile` (symbols, stemmed term counts, identifier uses), `buildIndex` (byPath, defs,
  users, the "uses a symbol defined in" graph, **stem-sibling edges**: files whose basename stems share a part ≥ 3
  chars get weak mutual edges — cli.py ↔ docs/cli.rst ↔ tests/test_cli.py — and **doc-mutual edges**: a docs page's
  uses-edges run both directions at half weight, since docs explain code rather than depend on it), `lexicalScore`
  (path ×3, defs ×2, tf, all IDF-weighted), `personalizedPageRank` (deterministic, dangling mass returns to the
  seed), `rankFiles` (four channels → RRF → reasons + per-channel ranks), `rarestTerms`/`grepTerms`.
- `context/symbols.ts` — extended with doc headings: `.md` `# heads` and `.rst` underlined titles become `doc`
  symbols, so docs pages get `defines` hits like code.
- `context/pack.ts` — `outlineOf` (40-symbol cap, methods indented), `fileItem`, `sliceItem`, `assemblePack`
  (pins → ranked outlines ≤ budget, ≤ 12 items, ≤ 5 skipped reasons), `renderPack` ("a map, not the files").
- `context/mentions.ts` — `parseMentions`: `@path` and `@symbol:Name`; unknown mentions stay in the text and come
  back in `unresolved`.
- `context/indexer.ts` (extension) — `IndexStore` (get/ready/update/remove), `indexWorkspaceInBackground`
  (chunks of 50, yields between chunks, skips binaries / >300 KB), `ContextPacks.packFor` = rule 40's
  withinBudget: full (index + grep) 800 ms → quick (lexical only) 200 ms → none.
- `mcp/server.ts` — `repo_map` now ranks real outlines with reasons; `pack_context` (LSP → index fallback) was
  already wired; `list_changes` now sees the **live** turn (turnRef), so Stop also kills `run_command`/`search_workspace`.
- Webview — PackCard shows `used / budget`, a fill bar, per-row path·tokens·reasons and per-channel rank chips,
  skipped rows, and a "View as sent" verbatim toggle. Composer autocompletes `@` (files then symbols, ≤ 20) and
  `/` (workflows).
- Re-index on save, on delete, and after every applied checkpoint (`persist` → `reindexFile`).

## Evidence

- `npx vitest run --project unit`: 129 tests — tokens, symbols (+doc headings), rrf (rank math, empty channel,
  duplicates, ties, k≤0), repomap (terms, PageRank 4-node, minipkg Task-B top-5, missing channel, deterministic,
  reasons, rarestTerms, stem siblings, doc-mutual), pack (budget property, pins, skipped, slice), symbolPack
  (caps, trim order, definition truncation, render), mentions, budget (full/quick/none/throw), mcp-tools (11
  tools, repo_map ranked).
- `npx vitest run --project perf` (2× budgets, generated 400-file repo):
  `index.build 31ms` (≤ 3,000), `rankFiles median 5.9ms` (≤ 100), `assemblePack 0.1ms` (≤ 160),
  `shapeSymbolPack 0.1ms` (≤ 20).
- The Task-B ranking on the real flask 3.1.3 clone (`index.build 233 ms, 183 files`, grep terms `cli, json, config`):

  ```
  1. tests/test_basic.py          lexical #3 · graph #1  · grep #1
  2. src/flask/app.py             lexical #5 · graph #3  · grep #8
  3. tests/test_cli.py            lexical #1 · graph #16 · grep #4
  4. CHANGES.rst                  lexical #9 · graph #9  · grep #2
  5. src/flask/sansio/app.py      lexical #7 · graph #4  · grep #10
  6. src/flask/cli.py             lexical #2 · graph #13 · grep #9
  7. tests/test_testing.py        lexical #4 · graph #17 · grep #5
  8. docs/config.rst              lexical #6 · graph #18 · grep #3
  9. tests/test_config.py         lexical #8 · graph #7  · grep #11
  10. tests/test_blueprints.py    lexical #17 · graph #5 · grep #6
  …
  13. docs/cli.rst                lexical #14 · graph #29 · grep #12
  ```

  **Deviation (recorded honestly):** the goal is `cli.py`, `test_cli.py`, `docs/cli.rst` in the top 5. Achieved:
  `test_cli.py` #3, `cli.py` #6; `docs/cli.rst` is #13 of 183 — inside the pack's item list but below the top-5
  line. The workflow's three levers were swept exhaustively (path 3–5 × defs 2–4 × tf 0.5–2 × damping 0.6–0.85 ×
  grep n 0–8 ≈ 162 combinations, plus seed-compression variants) — best worst-position 12. The rank improvements
  that *are* in (doc-heading symbols, stem-sibling edges, doc-mutual edges, path-naming grep terms) moved
  cli.rst from #32 → #13 and test_cli.py into the top 3, all generic mechanisms, none flask-fitted. The residual
  gap is structural: docs pages get few PageRank in-edges (2 stem siblings here) and a thin lexical profile
  versus ~80 test files whose `test_*` names echo the query terms. On the minipkg fixture (the required unit
  case) all three target files are in the top 5 — the strategy is correct on a normally-proportioned repo.

- `pack_context`: the index fallback is covered by `mcp-tools.test.ts` ("from index" output asserted). The
  LSP-backed call is a HUMAN CHECK below.
- Pack card showing ranks during a real Task B run: HUMAN CHECK below.

## HUMAN CHECKS

- `co4fe3.dev.rank` in the Dev Host (flask open) — paste the Task B instruction; the output channel prints the
  same top-10 with reasons and per-channel ranks.
- `pack_context` on flask with the Python extension **installed**: `{ path: "src/flask/cli.py", symbol:
  "FlaskGroup", task: "extend" }` returns `source: lsp` with callers; with the extension **disabled** it returns
  `source: index`. Paste both into this file.
- Real Task B run: the pack card shows `used / budget`, rank chips per row, and "View as sent" matches the first
  message the model got.

## Retrospective

The file-view layer diverged once mid-workflow (an `edit` landed in the tool view but not the shell's view); all
edits were re-verified via `grep`/`sed` before continuing. Recording so it isn't rediscovered the hard way.
