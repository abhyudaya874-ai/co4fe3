# co4fe3 — Devin pack

co4fe3 is a VS Code coding agent whose agent loop runs on **TrueForge** (local mode). It is the entry for the
Techfest 2026-27 TrueFoundry Forge-a-thon, Round 1 (deadline **20 Nov 2026, 23:59 IST**).

This folder is the build kit: the rules, workflows, skills, subagent profiles, hooks and docs a coding agent (Devin, or
any agent that reads `AGENTS.md`) needs to build co4fe3 without making architecture mistakes. Every rule carries the
code it expects, so a small model copies a shape instead of inventing one.

The architecture follows **V3Code** (`/home/de3p/V3Code`, an Apache-2.0 AI editor built on Void and Code-OSS) wherever
a VS Code extension can do the same thing. `docs/study/v3code.md` maps each borrowed idea to its V3Code file. No V3Code
code is copied (rule 05).

## Install

```bash
cd /home/de3p/co4fe3
chmod +x scripts/hooks/*.sh
bash scripts/hooks/test-hooks.sh      # the hooks guard every edit; this proves they work (needs jq)
node scripts/check-invariants.mjs     # the mechanical laws; passes on the bare pack
```

Then open `/home/de3p/co4fe3` in Devin and paste `MASTER_PROMPT.md`. Devin runs `/start-session`, then the
workflows in numeric order, one per message. Keep `/home/de3p/V3Code` where it is: the rules read it, and the hooks
refuse writes into it.

## What the product is (one screen)

```
VS Code ─┬─ Inline edit (Ctrl+Alt+K) ──────────────┐
         └─ Agent panel (webview, Agent/Ask/Plan) ──┤
                                                    ▼
   extension host ── @truefoundry/trueforge-sdk ──▶ TrueForge (npx, localhost:8790) ──▶ model providers
         ▲                                              │       (NVIDIA NIM primary, Gemini Flash-Lite fallback)
         └── editor MCP server (127.0.0.1, bearer) ◀────┘  repo_map · search_workspace · find_symbol · pack_context
                │                                           read_file · list_changes · board_read · board_write
                └── VS Code language features (LSP)         load_instructions · propose_edit · run_command
```

- **TrueForge runs the loop.** The extension creates sessions, streams turns, answers pauses and cancels. It never calls
  a model provider.
- **Editor capabilities are MCP tools.** TrueForge calls them over HTTP on 127.0.0.1. `propose_edit` and `run_command`
  are gated by **TrueForge tool approval**, and that approval pause is where the per-hunk diff review happens.
  "Read-only" means "has no approval category", and the Agent/Ask/Plan modes are derived from that one map (V3Code).
- **Nothing reaches disk before a person accepts a hunk.** Every applied hunk has a checkpoint, so Undo restores exact
  bytes. After an apply, only errors the edit *introduced* are reported back (V3Code's verify-against-baseline).
- **Context is ranked, budgeted and explained.** Four cheap channels (lexical, dependency graph, grep, recent) are fused
  with Reciprocal Rank Fusion. The pack card shows each file's rank per channel. `pack_context` returns
  definitions, callers and diagnostics from the language server, under a token budget.
- **The crew follows UltraPals' and V3Code's rules.** The lead is the only voice. It briefs subagents that TrueForge
  spawns (the lead names them) with a `research` or `work` profile that code enforces. Each subagent reports back once,
  and a report that claims edits it never made is marked blocked. Subagents never message each other; they share facts
  on the board.
- **Latency comes from design and gets measured.** One round trip for inline edit, preloaded tools in read-first order,
  a pre-warmed session, a retrieval budget with a lexical fallback, delayed hedging, stall watchdogs, and per-model
  time-to-first-token stats that order the models.

## Files

```
co4fe3/
├── README.md                     this file
├── AGENTS.md                     read first: laws, read order, commands, definition of done
├── MASTER_PROMPT.md              paste into Devin to start
├── NOTICE                        design credits (V3Code, Void, Cline, Aider, Continue); no third-party code
├── .devin/
│   ├── config.json               permissions (allow / ask / deny)
│   ├── hooks.v1.json             SessionStart · PreToolUse(exec, edit) · PostToolUse(edit) · Stop
│   ├── rules/
│   │   ├── 00-mission.md         product, eligibility gate, scoring map, non-goals
│   │   ├── 05-reference-v3code.md  V3Code as reference architecture: ideas yes, code never
│   │   ├── 10-architecture.md    layers, package boundaries, the single write path
│   │   ├── 20-trueforge.md       the verified SDK surface and its traps
│   │   ├── 30-review-and-safety.md  hunks, approval→review, conflicts, verify, checkpoints, undo, cancel
│   │   ├── 40-context.md         channels + RRF, context pack, pack_context, budgets, @mentions
│   │   ├── 50-crew.md            modes, profiles, runtime policy, lead + subagents, evidence, board
│   │   ├── 60-latency.md         budgets, levers, adaptive model order, delayed hedge, watchdogs
│   │   ├── 70-models.md          providers, fallback state machine (Task C)
│   │   ├── 80-testing.md         test pyramid, fake model server, fixtures, perf tests
│   │   ├── 85-instructions.md    the product reads AGENTS.md, rules, workflows, skills
│   │   ├── 90-small-model-protocol.md
│   │   └── 95-commit-and-timebox.md
│   ├── workflows/                start-session, 00-bootstrap … 13-submit, feature-slice, bug-triage, release-check
│   ├── skills/<name>/SKILL.md    explore-codemap, ship-slice, verify-loop, review-diff, research-web,
│   │                             trueforge-sdk, vscode-extension, latency-probe, judge-mode, orchestrate
│   └── agents/                   forge-scout, forge-editor, forge-verifier, forge-reviewer, forge-oracle
├── scripts/
│   ├── hooks/*.sh                the guards the hooks run; test-hooks.sh proves them
│   ├── verify.mjs                the gate; writes .devin/.last-verify
│   ├── check-invariants.mjs      mechanical architecture checks
│   └── setup-trueforge.mjs, bench-latency.mjs, smoke-live.mjs, save-agents.mjs
├── docs/
│   ├── CODEMAP.md                every planned file and its exact exports (look names up here)
│   ├── PATTERNS.md               copyable recipes
│   ├── ANTI-PATTERNS.md          wrong → right
│   ├── DECISIONS.md              why each choice was made
│   ├── LATENCY.md                how to measure, what the numbers mean
│   ├── WRITEUP.md                the 8-heading write-up skeleton and scorecard
│   ├── BACKLOG.md                deferred work (the app on a V3Code fork comes after Round 1)
│   └── study/v3code.md           the V3Code architecture map and the adopt/adapt/skip table
├── agents/                       the TrueForge agent definitions the product uses (judges require them)
│   ├── co4fe3-coder.agent.json
│   └── co4fe3-inline.agent.json
└── config/
    └── providers.example.json    model providers for TrueForge, no keys
```

## Sources the pack was checked against (19 Nov 2026)

- TrueForge docs: trueforge.dev (quickstart, SDK quickstart, use-agent, create-agent, models, MCP servers, subagents,
  deferred tool loading, roadmap) and the OpenAPI pages for sessions, turns, MCP servers and model providers.
- `@truefoundry/trueforge-sdk@0.185.0` type definitions on unpkg: `SessionsClient`, `BaseClient`,
  `ModelProvidersClient`, `AgentSpec`, `RuntimeConfig`, `McpServer`, `ModelParams`, `ThreadCreatedEvent`,
  `ThreadDoneEvent`, `ModelMessageEvent`.
- `@modelcontextprotocol/sdk@1` type definitions: `server/mcp.d.ts` (`registerTool`), `server/streamableHttp.d.ts`
  (stateless `sessionIdGenerator: undefined`).
- VS Code built-in commands (code.visualstudio.com/api/references/commands): `vscode.executeDocumentSymbolProvider`,
  `executeDefinitionProvider`, `executeReferenceProvider`, `executeHoverProvider`, `prepareCallHierarchy`,
  `provideIncomingCalls`.
- V3Code (`/home/de3p/V3Code`, commit `2eac91fb`): `localAgentRuntime.ts`, `subagentLifecycle.ts`,
  `toolsServiceTypes.ts`, `prompt/prompts.ts`, `chatThreadService.ts`, `editCodeService.ts`, `turboDraft*.ts`,
  `semanticIndex/{rrf,retriever,retrieveBudget,chunker}.ts`, `autoContextService.ts`,
  `contextBridge/contextBridgeTools.ts`, `mcpExpose/*`, `skillsService.ts`, `convertToLLMMessageService.ts`.
- UltraPals (`/home/de3p/paypal`): `lib/computer/main-agent.ts`, `events.ts`, `run.ts`, `model.ts`,
  `lib/swarm/tree/policy.ts`, `lib/integrations/chat.ts` (the NIM base URL and Gemini limits were measured there).
