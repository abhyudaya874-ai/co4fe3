# co4fe3 — Devin pack

co4fe3 is a VS Code coding agent whose agent loop runs on **TrueForge** (local mode). It is the entry for the
Techfest 2026-27 TrueFoundry Forge-a-thon, Round 1 (deadline **20 Nov 2026, 23:59 IST**).

This folder is the build kit: the rules, workflows, skills, subagent profiles, hooks and docs a coding agent (Devin, or
any agent that reads `AGENTS.md`) needs to build co4fe3 without making architecture mistakes. Every rule carries the
code it expects, so a small model copies a shape instead of inventing one.

## Install

The pack was staged inside the UltraPals repo. Move it to its own repository first:

```bash
mv /home/de3p/paypal/co4fe3 /home/de3p/co4fe3
cd /home/de3p/co4fe3
git init && git add -A && git commit -m "chore: devin pack"
chmod +x scripts/hooks/*.sh
```

Then open `/home/de3p/co4fe3` in Devin and paste `MASTER_PROMPT.md`. Devin runs `/start-session`, then the
workflows in numeric order, one per message.

> Until it is moved, keep the folder out of UltraPals commits. UltraPals' `tsconfig.json` type-checks every `**/*.ts`,
> so this pack holds **no `.ts` files**. Code lives inside the markdown until the real repo exists.

## What the product is (one screen)

```
VS Code ─┬─ Inline edit (Ctrl+Alt+K) ──────────────┐
         └─ Agent panel (webview) ─────────────────┤
                                                    ▼
   extension host ── @truefoundry/trueforge-sdk ──▶ TrueForge (npx, localhost:8790) ──▶ model providers
         ▲                                              │       (NVIDIA NIM primary, Gemini Flash-Lite fallback)
         └── editor MCP server (127.0.0.1, bearer) ◀────┘  read_file · search_workspace · find_symbol · repo_map
                                                           propose_edit · run_command · board_read · board_write
```

- **TrueForge runs the loop.** The extension creates sessions, streams turns, answers pauses and cancels. It never calls
  a model provider.
- **Editor capabilities are MCP tools.** TrueForge calls them over HTTP on 127.0.0.1. `propose_edit` and `run_command`
  are gated by **TrueForge tool approval**. That approval pause is where the per-hunk diff review happens.
- **Nothing reaches disk before a person accepts a hunk.** Every applied hunk has a checkpoint, so Undo restores exact
  bytes.
- **The crew follows UltraPals' rules.** The lead is the only voice. It briefs subagents that TrueForge spawns (the lead
  names them). Each subagent reports back once. Subagents never message each other; they share facts on the board.
- **Latency comes from design and gets measured.** One round trip for inline edit, preloaded tools, a pre-warmed
  session, delayed hedging, and per-model time-to-first-token stats that order the models.

## Files

```
co4fe3/
├── README.md                     this file
├── AGENTS.md                     read first: laws, read order, commands, definition of done
├── MASTER_PROMPT.md              paste into Devin to start
├── .devin/
│   ├── config.json               permissions (allow / ask / deny)
│   ├── hooks.v1.json             SessionStart · PreToolUse(exec, edit) · PostToolUse(edit) · Stop
│   ├── rules/
│   │   ├── 00-mission.md         product, eligibility gate, scoring map, non-goals
│   │   ├── 10-architecture.md    layers, package boundaries, the single write path
│   │   ├── 20-trueforge.md       the verified SDK surface and its traps
│   │   ├── 30-review-and-safety.md  hunks, approval→review, checkpoints, undo, cancel, path jail
│   │   ├── 40-context.md         repo map, context pack, token budget, @mentions
│   │   ├── 50-crew.md            lead + subagents, brief/report, board, caps
│   │   ├── 60-latency.md         budgets, levers, adaptive model order, delayed hedge
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
│   ├── hooks/*.sh                the guards the hooks run
│   ├── verify.mjs                the gate; writes .devin/.last-verify
│   └── check-invariants.mjs      mechanical architecture checks
├── docs/
│   ├── CODEMAP.md                every planned file and its exact exports (look names up here)
│   ├── PATTERNS.md               copyable recipes
│   ├── ANTI-PATTERNS.md          wrong → right
│   ├── DECISIONS.md              why each choice was made
│   ├── LATENCY.md                how to measure, what the numbers mean
│   ├── WRITEUP.md                the 8-heading write-up skeleton and scorecard
│   └── BACKLOG.md                deferred work (the Code-OSS app comes after Round 1)
├── agents/                       the TrueForge agent definitions the product uses (judges require them)
│   ├── co4fe3-coder.agent.json
│   └── co4fe3-inline.agent.json
└── config/
    └── providers.example.json    model providers for TrueForge, no keys
```

## Sources the pack was checked against (19 Nov 2026)

- TrueForge docs: trueforge.dev (quickstart, SDK quickstart, use-agent, create-agent, models, MCP servers, subagents,
  deferred tool loading, roadmap) and the OpenAPI pages for sessions, turns, MCP servers and model providers.
- `@truefoundry/trueforge-sdk@0.185.0` type definitions on unpkg: `SessionsClient`, `AgentSpec`, `RuntimeConfig`,
  `McpServer`, `ModelParams`, `ThreadCreatedEvent`, `ThreadDoneEvent`, `ModelMessageEvent`.
- `@modelcontextprotocol/sdk@1` type definitions: `server/mcp.d.ts` (`registerTool`), `server/streamableHttp.d.ts`
  (stateless `sessionIdGenerator: undefined`).
- UltraPals (`/home/de3p/paypal`): `lib/computer/main-agent.ts`, `events.ts`, `run.ts`, `model.ts`,
  `lib/swarm/tree/policy.ts`, `lib/integrations/chat.ts` (the NIM base URL and Gemini limits were measured there).
