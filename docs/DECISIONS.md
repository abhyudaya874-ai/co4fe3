# DECISIONS

Each decision lists what was chosen, the alternative, and why. The write-up (sections 2–5 and 8) quotes these.
Change a decision only in its own commit, with the reason.

**D1 Build from scratch, no fork.** The alternative was forking Cline and removing its agent loop and provider layer.
Removing them touches most of Cline, and keeping any of its loop is an eligibility failure. From scratch, the fork
point is simply "from scratch", the git history is short and readable, and the core can be reused by a Code-OSS app
later. Ideas, not code, come from other projects (D18).

**D2 Exact pins.** The TrueForge server is pinned in `npm run trueforge` (`<PINNED>`, filled in at bootstrap).
`@truefoundry/trueforge-sdk` is `0.185.0`, the release that introduced paused turns. `@modelcontextprotocol/sdk` is
`1.x` (exact). zod follows the MCP SDK's peer dependency. `diff`, `vitest`, `fast-check`, `esbuild`, `vite`, `react`
and `@vscode/test-cli` are pinned exactly at install time. The full versions list is written here at bootstrap.

**D3 Inline-spec sessions.** A named agent was the alternative, but named sessions reject agent updates, so the model
could not be switched for fallback. The agent JSON files are written in the TS SDK's camelCase, so they go straight
into `sessions.create`. `scripts/save-agents.mjs` also saves them as named agents, so they appear in the TrueForge UI.

**D4 Editor tools as a localhost HTTP MCP server.** TrueForge connects only to remote MCP servers (streamable HTTP or
SSE), so stdio was not an option. Each window gets a server on 127.0.0.1 with a random bearer token, a Host check
against DNS rebinding, and the name `co4fe3-ws-<hash>`, so two windows do not overwrite each other.

**D5 The approval pause is the review.** `propose_edit` and `run_command` are gated by literal name. At the pause,
the extension computes the hunks and the user decides each one. After **allow**, the tool runs and writes only what
was accepted, using the decision it takes from the store by key. Rejecting everything sends **deny** with a reason
the model can act on. This is the B4 anchor 7 point: "TrueForge tool approval driving the diff review".

**D6 Inline edit has no tools.** The model streams one fenced block for the selected lines, and the extension diffs
it locally. This is one model round trip instead of two or more. It works with any OpenAI-compatible model, because
it needs no tool calling and no JSON mode, and the diff can grow live as tokens arrive. The cost: inline edit cannot
read other files. The prompt carries 40 lines of context and the file outline instead.

**D7 Symbols from regex and indentation, not tree-sitter.** There are no native or WASM dependencies, it takes about
40 lines, and it covers Python (`def`, `class`, click `@*.command("name")`) and TS/JS definitions. The trade-off is
lower precision on decorators, nested functions and multi-line signatures. Tree-sitter is in the backlog.

**D8 Personalized PageRank over a "uses a name defined in" graph.** This reimplements Aider's repo-map idea:
lexical matches, mentions and the active file seed a PageRank. It is deterministic, takes milliseconds, explains
itself through its reasons, and needs no embedding model. The trade-off is no semantic matching: synonyms rely on
stemming and prefix matches.

**D9 No tsc emit.** tsc only type-checks. esbuild bundles the extension (CJS, `vscode` external) and Vite bundles the
webview. agent-core's `exports` point at its TypeScript source, so there is no `dist/` to go stale.

**D10 The crew is TrueForge dynamic subagents, named by the lead.** Roles come from the brief's first line
(`ROLE: explore|edit|test|review`) and are enforced at the approval pause. Members never message each other: brief
down, report up, and the board for shared facts. This copies the UltraPals team model, without Battle or Loop.
The product works the same with the crew off, or with a model that never delegates.

**D11 Preload our tools; defer everything else.** Our 10 tools cost about 2k tokens preloaded. Deferring them would
cost three discovery round trips the first time each one is used. MCP servers the user adds keep the deferred
default. This is a deliberate use of TrueForge's deferred tool loading, explained in the write-up.

**D12 Compaction at 60% of the model's context; large-tool-response offloading off.** Offloading needs a sandbox,
and we run without one, so our tools cap their own output (rule 40 budgets). Compaction events show in the panel as
markers.

**D13 Model fallback lives in the client.** TrueForge has no automatic model selection yet (it is on its roadmap). We
classify the failure, bench the model, and retry on the next one only before any side effect. A stall timer catches
unreachable endpoints that would otherwise hang.

**D14 Delayed hedge for inline edit only.** If the first model has not streamed by its p90 TTFT (clamped to 2.5–8 s),
the next model starts, and the first to stream wins. It is safe because nothing is written before review. Agent
mode never hedges, because its tools have side effects.

**D15 React + Vite webview themed only through VS Code's CSS variables; no Tailwind.** The view matches every theme
for free, the bundle is small, and there is no extra build step. Model text renders as React elements only.

**D16 The product reads Devin-format instructions.** `.co4fe3/` comes first, then `.devin/`. Skills load through our
`load_instructions` MCP tool, because TrueForge's native skills need a sandbox.

**D17 NIM primary, Gemini Flash-Lite fallback.** UltraPals measured both in Nov 2026: NIM took 8 parallel requests
without a refusal, and Flash-Lite answered in 0.8–2 s. Both are free tiers, so they cost $0. The live bench decides
the final order.

**D18 Borrowed concepts, credited, no code copied.**
- Cline: approval flow, checkpoints.
- Continue: @-mentions, inline diff.
- Aider: repo map, search/replace edits.
- Roo Code: modes, which became roles.
- OpenHands: condensation, which TrueForge compaction covers.
- Goose: MCP-first tools.
- UltraPals (our own project): lead + crew, one event union with a pure reducer, the model router (cooldowns,
  stall timer, hedging), context accounting.
