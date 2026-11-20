# co4fe3: a VS Code coding agent on TrueForge

<!-- 1–3 pages as PDF. Keep the 8 headings exactly, in this order. Replace every ____ . Delete these comments. -->

## 1. Team

____ (members, college or employer, GitHub handles — filled by the submitter).

## 2. Starting point

From scratch: no upstream editor code. The architecture follows **V3Code** (github.com/HeavenFYouMissed/V3Code,
Apache-2.0, an AI editor on Void and Code-OSS, studied at commit 2eac91fb). We reimplemented its ideas in our own code:
- runtime turn policy;
- modes and subagent profiles derived from one approval map;
- evidence-checked workers;
- RRF retrieval with a latency budget;
- the LSP-backed context pack;
- verify-against-baseline after an edit.

Other concepts (not code), credited in `NOTICE`:
- Cline: approval flow and checkpoints.
- Continue: @-mentions and inline diff.
- Aider: repo map and search/replace edits.
- Roo Code: roles.
- Goose: MCP-first tools.
- UltraPals, our earlier project: lead + crew, event reducer, model router.

## 3. Architecture on TrueForge

<!-- diagram from README; then these points, each one sentence -->
- **The extension is a pure TrueForge client.** It creates inline-spec sessions, streams turns through
  `createTurnStream`, answers pauses with `createTurnEvents`, and cancels with `sessions.cancel`. It never calls a
  model provider.
- **Editor capabilities are MCP tools** on a loopback HTTP server, with a bearer token per window. The 11 tools,
  registered locators-first, are `repo_map`, `search_workspace`, `find_symbol`, `pack_context` (LSP-backed),
  `read_file`, `list_changes`, `board_read`, `board_write`, `load_instructions`, `propose_edit` and `run_command`.
  Agent, Ask and Plan modes are TrueForge `enableTools` sets derived from one approval map. Every call passes a turn
  policy that stops repeat loops and runs of failures.
- **TrueForge tool approval drives the review.** `propose_edit` pauses the turn. The user accepts or rejects each
  hunk, and only accepted hunks are written, with a checkpoint for Undo.
- **Harness features used, and why:**
  - *subagents*: the lead's crew, named by the lead, with brief and report visible in the panel and the session;
  - *deferred vs preloaded tools*: our 11 tools are preloaded to save discovery round trips, and others stay deferred;
  - *compaction*: at 60% of context.
- Agent definitions: `agents/co4fe3-coder.agent.json`, `agents/co4fe3-inline.agent.json`.

## 4. How context is selected

co4fe3 keeps a symbol index of the workspace (definitions, docstring first lines, identifiers), built in the
background and updated on save. For each request it ranks files in four independent channels — **lexical** (request
terms in paths, symbol names and docstrings, IDF-weighted), **graph** (personalized PageRank over a "uses a symbol
defined in" graph, seeded by lexical hits, @-mentions and the active editor), **grep** (ripgrep hits for the
discriminating request terms) and **recent** (open editors and files changed this session). The four lists are fused
with Reciprocal Rank Fusion (k = 60). A file's per-channel ranks are its explanation. The top files are packed as
outlines into a fixed 6,000-token budget, with @-mentions pinned first. Retrieval has a hard latency budget: 800 ms
for the full ranking, else a lexical-only pack within 200 ms, else the turn goes without one.

In Task B the pack chose test_cli.py #3, cli.py #6, docs/cli.rst #13 of 183 files (≈4,300 / 6,000 tokens; per-channel
ranks on the card), visible at ____ in the video.
Trade-off versus V3Code: no embeddings, so there is no semantic channel. Four cheap channels fused with RRF got the
right files for Task B, and `pack_context` gives compiler facts on demand.

## 5. Model setup

| Model | Where it ran | Role | Cost |
|---|---|---|---|
| nvidia-nim/nemotron-super | NVIDIA NIM (build.nvidia.com), free tier | primary | $0 |
| google-gemini/gemini-flash-lite | Google AI Studio, free tier | fallback | $0 |

Measured TTFT (`npm run bench:latency`, 2026-11-20, 5 runs each): primary p50 **0.74 s**, fallback p50 **2.04 s**
(fallback throughput ~1,900 tok/s vs ~180, which is why it pairs). To switch models, use the status-bar picker
or `co4fe3.models.order`. To add a provider, use TrueForge → Settings → Models, or `npm run setup:trueforge`, which
reads `config/providers.example.json`. Any OpenAI-compatible endpoint works as a `custom` provider.

## 6. Scorecard

| Criterion | Video | Claim |
|---|---|---|
| A1 Inline edit | ____ | diff in the editor with per-hunk accept/reject |
| A2 Agent mode | ____ | 3+ files edited, none named by the user |
| A3 Streaming + cancel | ____ | tokens stream; Esc/Stop is instant and leaves `git status` clean |
| B1 Context | ____ | budgeted pack with per-file reasons shown during Task B |
| B2 Diff safety | ____ | per-hunk review plus Undo of an applied change, on screen |
| B3 Resilience | ____ | broken primary → automatic fallback, banner, workspace unchanged |
| B4 TrueForge depth | ____ | MCP tools, approval-driven review, subagents visible in the TrueForge session |
| C1 Video | 0:00–____ | A, B, C in order, each verified on screen |
| C2 Write-up | — | this document |

## 7. Tools used

Devin (Cognition's agent, SWE-2 Max) implemented the extension inside this repository's Devin pack (rules,
workflows, hooks); VS Code + its extension host for development and testing; npx @truefoundry/trueforge 0.185.1 as
the agent loop; vitest for the test gate; esbuild + Vite for the bundles.

## 8. Known limitations and what we would do with another month

<!-- honest; each item one line with the consequence -->
- Symbols come from regex, not tree-sitter, so decorators and multi-line signatures are approximate. `pack_context`
  uses the language server when one is installed, and falls back to that index otherwise.
- No semantic (embedding) retrieval. V3Code fuses two embedding models with BM25; we fuse lexical, graph, grep and
  recent channels only.
- Repeat detection counts identical calls per turn, not batches (TrueForge owns the loop), so parallel members can
  share the count.
- Model fallback is client-side, because TrueForge has no automatic selection yet. A retry never happens after an
  approved edit.
- Whether the lead delegates depends on the model, and some models do Task B alone.
- No sandbox, so no TrueForge skills or Code Mode. Our skills load through an MCP tool instead.
- Free tiers rate-limit: Gemini flash-lite ~15 req/min on our key; nemotron-super intermittently truncated a
  64-token probe (it is a reasoning model — the bench uses 256). The bench table in docs/LATENCY.md is the live
  evidence.
- Next month: the co4fe3 app as a renamed V3Code fork running this same core on TrueForge (keeping V3Code's notices),
  tree-sitter symbols, an embeddings channel, a local sandbox when TrueForge ships one, and Windows testing.
