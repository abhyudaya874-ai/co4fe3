# DECISIONS

Each decision lists what was chosen, the alternative, and why. The write-up (sections 2–5 and 8) quotes these.
Change a decision only in its own commit, with the reason.

**D1 Build from scratch, no fork.** The alternative was forking Cline and removing its agent loop and provider layer.
Removing them touches most of Cline, and keeping any of its loop is an eligibility failure. From scratch, the fork
point is simply "from scratch", the git history is short and readable, and the core can be reused by the co4fe3 app
(a V3Code-based fork) later. Ideas, not code, come from other projects (D18, D19). Forking V3Code itself for Round 1
was rejected: the brief asks for a VS Code extension, V3Code is a whole editor whose first build takes hours, and it
keeps its own agent loop, which TrueForge must replace.

**D2 Exact pins.** The TrueForge server is pinned in `npm run trueforge` at `0.185.1` (wherever a rule says
`<PINNED>`). `@truefoundry/trueforge-sdk` is `0.185.0`, the release that introduced paused turns. The rest were
installed together in a bootstrap dry run on 19 Nov 2026 and pass the gate together: `@modelcontextprotocol/sdk`
1.32.2, zod 4.6.7 (inside the MCP SDK's peer range), diff 9.0.0 (ships its own types), typescript 7.0.2,
vitest 5.1.1, fast-check 4.10.3, @fast-check/vitest 0.5.0, @types/node 22.20.5, esbuild 0.28.2, vite 8.3.8,
@vitejs/plugin-react 6.3.0, react and react-dom 19.3.1, @types/react and @types/react-dom 19.3.0, @types/vscode
1.90.0 (matches `engines.vscode`), @vscode/test-cli 0.0.15, @vscode/test-electron 3.1.0, @types/mocha 10.0.10,
@vscode/vsce 4.1.1. Workflow 00 installs all of them, so no later workflow picks a version.

**D3 Inline-spec sessions.** A named agent was the alternative, but named sessions reject agent updates, so the model
could not be switched for fallback. The agent JSON files are written in the TS SDK's camelCase, so they go straight
into `sessions.create`. `scripts/save-agents.mjs` also saves them as named agents, so they appear in the TrueForge UI.

**D4 Editor tools as a localhost HTTP MCP server.** TrueForge connects only to remote MCP servers (streamable HTTP or
SSE), so stdio was not an option. Each window gets a server on 127.0.0.1 with a random bearer token, a Host check
against DNS rebinding, a loopback peer check (as V3Code's bridge accepts only loopback endpoints), a bound
on every result, and the name `co4fe3-ws-<hash>`, so two windows do not overwrite each other.

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

**D8 Four ranked channels fused with Reciprocal Rank Fusion (k = 60).** The channels are lexical, graph
(personalized PageRank over a "uses a name defined in" graph, Aider's repo-map idea), grep (ripgrep hits for the
rarest request terms) and recent (open and changed files). The fusion is V3Code's (`semanticIndex/rrf.ts`). RRF needs
no score calibration between channels, tolerates a missing channel, and its per-channel ranks are a free explanation
for the pack card. It is deterministic and takes milliseconds. The trade-off is no semantic matching: there are no
embeddings (V3Code uses two models and a sidecar), so synonyms rely on stemming and prefix matches. The earlier
weighted blend (0.6 PageRank + 0.4 lexical) was dropped: its weights were arbitrary and it could not explain itself.

**D9 No tsc emit.** tsc only type-checks. esbuild bundles the extension (CJS, `vscode` external) and Vite bundles the
webview. agent-core's `exports` point at its TypeScript source, so there is no `dist/` to go stale.

**D10 The crew is TrueForge dynamic subagents, named by the lead, with V3Code's two profiles.** The brief's
`PROFILE: research | work` line decides the profile, and a missing line means research. The profile is enforced at
the approval pause, and the advertised tools match the gate. V3Code's status vocabulary and evidence check decide
`completed` versus `blocked`. Members never message each other: brief down, report up, and the board for shared
facts. This copies the UltraPals team model, without Battle or Loop. The product works the same with the crew off,
or with a model that never delegates. Five ad-hoc roles were replaced by two profiles, because two profiles derive
from the approval map and five roles needed their own tables.

**D11 Preload our tools in read-first order; defer everything else.** Our 11 tools cost about 2.2k tokens
preloaded, registered locators-first because models treat list position as priority (V3Code `availableTools`). Deferring them would
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

**D16 The product reads Devin- and V3Code-format instructions.** It reads V3Code's list of instruction files
(AGENTS.md, CLAUDE.md, .cursorrules, …), its skill triggers (globs, keywords, alwaysApply) and its
`<skills_index>` / `<active_skills>` split. `.co4fe3/` wins over `.v3code/` and `.devin/` for skills. Skills load
through our `load_instructions` MCP tool, because TrueForge's native skills need a sandbox. Active skills go in the
turn message, not the instructions, so the prompt prefix stays cacheable.

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
- V3Code: see D19.

**D19 V3Code is the reference architecture; ideas are reimplemented, never copied.** V3Code
(github.com/HeavenFYouMissed/V3Code, Apache-2.0, studied at `2eac91fb`) is the most complete open source AI editor on
Void, and its policy lives in pure modules that translate well to an extension. The full adopt/adapt/skip table is in
`docs/study/v3code.md` §15. We adopted:
- the runtime turn policy (repeat 3/5, mistake stop);
- modes and profiles derived from one approval map;
- read-first tool order;
- evidence-checked members and the canonical status vocabulary;
- the cancel order;
- truncation with a recovery hint and a bound on every MCP result;
- typed command timeouts and stream watchdogs;
- RRF retrieval with a latency budget;
- the LSP-backed `pack_context` with per-task caps and trim order;
- closed edit-reject reasons;
- verify-against-baseline after an apply;
- the inline run-state machine with `sourceChanged`;
- the instruction-file list and skill triggers.

We skipped what needs workbench internals or native code: in-buffer diff zones (D20), embeddings, tree-sitter, the
Beast sidecar, voice, browser and computer use. No V3Code code is copied: rule 05, enforced by `guard-write.sh` and
`check-invariants.mjs`. `NOTICE` credits the design.

**D20 Proposal document + diff editor, not V3Code's in-buffer diff zones.** V3Code streams edits into the buffer and
reverts rejected diffs, with view zones and an undo element per step. An extension cannot draw those zones, and
writing before the decision breaks the Forge-a-thon's "no silent writes". Our proposal lives in a virtual document
shown in VS Code's diff editor. The file is written once, after the decision, through the single writer. The cost is
a separate tab instead of inline red/green; the gain is that the file on disk never holds an undecided change.

**D21 One review per file per pause.** When TrueForge pauses on several `propose_edit` calls for the same file, only
the first is reviewed and the rest are denied with a reason. This is V3Code's "reject-conflicts" behaviour, fixed.
TrueForge does not promise the order in which it runs the handlers, so planning two proposals against the same
`before` would produce a conflict. Denying is deterministic, and the model simply proposes again.
