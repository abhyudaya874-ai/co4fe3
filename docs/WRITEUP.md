# co4fe3: a VS Code coding agent on TrueForge

<!-- 1–3 pages as PDF. Keep the 8 headings exactly, in this order. Replace every ____ . Delete these comments. -->

## 1. Team

____ (members, college or employer, GitHub handles).

## 2. Starting point

From scratch: no upstream editor code. Concepts (not code) borrowed and credited:
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
- **Editor capabilities are MCP tools** on a localhost HTTP server, with a bearer token per window. The 10 tools
  are `read_file`, `search_workspace`, `find_symbol`, `repo_map`, `propose_edit`, `run_command`, `board_read`,
  `board_write`, `list_changes` and `load_instructions`.
- **TrueForge tool approval drives the review.** `propose_edit` pauses the turn. The user accepts or rejects each
  hunk, and only accepted hunks are written, with a checkpoint for Undo.
- **Harness features used, and why:**
  - *subagents*: the lead's crew, named by the lead, with brief and report visible in the panel and the session;
  - *deferred vs preloaded tools*: our 10 tools are preloaded to save discovery round trips, and others stay deferred;
  - *compaction*: at 60% of context.
- Agent definitions: `agents/co4fe3-coder.agent.json`, `agents/co4fe3-inline.agent.json`.

## 4. How context is selected

<!-- paste the strategy paragraph from rule 40, then the budget table, then one sentence on what Task B showed -->
____ In Task B the pack chose ____ (____ / 6,000 tokens), visible at ____ in the video.

## 5. Model setup

| Model | Where it ran | Role | Cost |
|---|---|---|---|
| nvidia-nim/____ | NVIDIA NIM (build.nvidia.com), free tier | primary | $0 |
| google-gemini/____ | Google AI Studio, free tier | fallback | $0 |

Measured TTFT (bench, ____): primary p50 ____ s, fallback p50 ____ s. To switch models, use the status-bar picker
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

____ (for example: Devin with ____ models for implementation, Kiro for planning the build pack, VS Code). AI
coding assistants are declared here as the rules require.

## 8. Known limitations and what we would do with another month

<!-- honest; each item one line with the consequence -->
- Symbols come from regex, not tree-sitter, so decorators and multi-line signatures are approximate.
- Model fallback is client-side, because TrueForge has no automatic selection yet. A retry never happens after an
  approved edit.
- Whether the lead delegates depends on the model, and some models do Task B alone.
- No sandbox, so no TrueForge skills or Code Mode. Our skills load through an MCP tool instead.
- Free tiers rate-limit: ____.
- Next month: a Code-OSS based app with this same core, tree-sitter symbols, optional embeddings, a local sandbox
  when TrueForge ships one, and Windows testing.
