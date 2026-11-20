# co4fe3 — a VS Code coding agent on TrueForge

co4fe3 is a VS Code extension whose agent loop runs entirely on **TrueForge local mode** (`npx @truefoundry/trueforge`
on `localhost:8790`). The extension never calls a model provider: it creates sessions, streams turns, answers approval
pauses and renders everything. Editor capabilities are exposed to the agent as an authenticated HTTP MCP server on
127.0.0.1 — `propose_edit` and `run_command` pause for human approval, and that pause is the per-hunk diff review.

> GIF of Task A lands here (`media/task-a.gif`, recorded in workflow 11).

## Requirements

- Node ≥ 22.14, npm, git
- VS Code ≥ 1.90 (the Extension Development Host for `npm run dev`, or a normal install for the .vsix)
- Python ≥ 3.9 for the flask demo workspace
- An **NVIDIA NIM** key and a **Gemini** key (free tiers are fine), or any OpenAI-compatible endpoint
  (`config/providers.example.json` shows OpenRouter / OmniRoute / freellmapi / Ollama shapes too)

## Setup from a clean clone

```bash
git clone https://github.com/<you>/co4fe3 && cd co4fe3
npm ci
npm run trueforge                            # terminal 1: TrueForge local on http://localhost:8790
cp config/providers.example.json config/providers.json
export NVIDIA_API_KEY=…  GEMINI_API_KEY=…    # keys live in env vars; nothing writes them to disk
npm run setup:trueforge                      # registers both providers + prints models.list + the order
npm run build
code --extensionDevelopmentPath="$PWD/extensions/co4fe3-vscode" /path/to/flask   # or: install the .vsix
```

TrueForge needs outbound access to `localhost` (our MCP server) — `npm run trueforge` sets
`OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1","localhost"]'` itself.

## The agent definitions

Sessions are created from `agents/co4fe3-coder.agent.json` (agent panel) and `agents/co4fe3-inline.agent.json`
(inline edit) automatically — no manual step. To also see them as saved agents in the TrueForge UI, run
`node scripts/save-agents.mjs` (uses `client.agents.create`/`update`).

## Use it

- **Inline edit (Ctrl+Alt+K)**: select code, describe the change, watch the diff stream into a diff editor.
  Accept or reject **per hunk**; `co4fe3: Undo` restores exact bytes. `co4fe3: Stop` cancels mid-stream.
- **Agent panel** (the co4fe3 sidebar): Agent / Ask / Plan modes, `@file` and `@symbol` mentions, `/workflow`
  expansion, streamed crew rows (lead briefs → member reports), tool cards, per-hunk diff review, a command
  card for `run_command`, and **Open session in TrueForge** for the live session page.
- **Stop** cancels the turn at once; nothing half-applies because writes only happen after you accept a hunk.
- **Plan mode** answers with a numbered plan and never opens a review.

## Switch models

The status-bar model item opens `co4fe3: Pick model` (lists TrueForge's `models.list`, with measured stats in the
description), or set `co4fe3.models.order` directly. If the primary fails — bad key, 500, hang — the request falls
back automatically to the second model, the banner says who failed and who answered, and the model gets benched
until its cooldown expires (`co4fe3: Reset model stats` clears this). To add a provider, use TrueForge's
Settings → Models.

## Fork point

Built from scratch — no upstream editor code. The architecture follows **V3Code**
(github.com/HeavenFYouMissed/V3Code, Apache-2.0, studied at commit `2eac91fb`), reimplemented in our own code
(rule 05: read it, never copy it). Ideas (not code) from Cline, Continue, Aider and our own UltraPals project are
credited in `NOTICE` and the write-up.

## Architecture

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

- `packages/agent-core` is the pure-TS brain (no `vscode`, no `child_process`, no `fs` writes): turn driver, MCP
  tools, ranking, review math, modes/crew, stats + fallback.
- `extensions/co4fe3-vscode` is the VS Code glue: `host/` implements `EditorHost`, `review/apply.ts` is the
  **only** file that can write workspace bytes, `panel/` is the webview bridge, `forge/` the session pool + router.
- Design reasoning: `docs/DECISIONS.md`. Latency budgets + measured numbers: `docs/LATENCY.md`.

## Tests

```bash
npm run verify          # invariants (740 checks) → typecheck → unit → perf → integration → e2e
npm run verify:fast     # invariants + typecheck + unit only
npm run bench:latency   # live TTFT/throughput table through TrueForge for every configured model
```

Integration tests run a real TrueForge plus a scripted OpenAI-compatible fake model server plus the real MCP
server over a temp workspace. The e2e tests launch the Extension Development Host.

## License

MIT — see `LICENSE` and `NOTICE`.
