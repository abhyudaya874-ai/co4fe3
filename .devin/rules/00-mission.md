---
trigger: always_on
description: What co4fe3 is, the eligibility gate, how each judging criterion maps to code, and what is out of scope
---

# Mission

co4fe3 is a VS Code extension. It is a **client of a TrueForge agent**: it creates sessions, sends turns, renders the
streamed events and answers pauses. Editor capabilities are exposed to that agent as **MCP tools**, so the agent decides
what to read and change. The model is configured in TrueForge and never called by the extension.

## Eligibility gate (pass/fail, checked before any points)

| Gate | How co4fe3 meets it | Where |
|---|---|---|
| Agent loop runs on TrueForge | every turn goes through `client.sessions.createTurnStream` | `packages/agent-core/src/forge/turn.ts` |
| Editor capabilities are MCP tools | HTTP MCP server on 127.0.0.1, registered with `client.settings.mcpServers.createOrUpdate` | `packages/agent-core/src/mcp/*` |
| TrueForge in local mode | `npm run trueforge` → `npx @truefoundry/trueforge@<pinned>` | `package.json` |
| Model configured in TrueForge | `npm run setup:trueforge` → `client.settings.modelProviders.createOrUpdate` | `scripts/setup-trueforge.mjs` |
| Extension never calls a provider | `check-invariants.mjs` fails on provider hostnames or SDK imports | `scripts/check-invariants.mjs` |
| Agent definition in the repo | `agents/co4fe3-coder.agent.json`, `agents/co4fe3-inline.agent.json` | `agents/` |
| Session shown in the video (Task B) | the panel's "Open session in TrueForge" link | `extensions/co4fe3-vscode/src/panel/*` |

If any row breaks, nothing else counts. These rows are checked first in every review.

## Scoring map (100 points). Build to the top anchor of each row.

| Criterion | Top anchor (what the judge must see) | Built in workflow |
|---|---|---|
| A1 Inline edit (10) | the diff is rendered in the editor, with per-hunk accept and reject | 03, 04 |
| A2 Agent mode (10) | the agent discovers and edits 3+ files nobody named (Task B) | 02, 05, 07 |
| A3 Streaming + cancel (10) | Stop cancels at once and the workspace stays consistent | 05 |
| B1 Context (15) | retrieval within a size budget, the strategy written up, and Task B **shows which files were chosen and why** | 06 |
| B2 Diff safety (10) | per-hunk review **and a working Undo of an applied change, shown on screen** | 03 |
| B3 Resilience (10) | **automatic fallback to a second configured model**, no user action, workspace unchanged | 08 |
| B4 TrueForge depth (10) | MCP tools, approval driving the review, and a context-engineering feature visible in the session (subagents + deferred/preloaded tools + compaction) | 02, 07 |
| C1 Video (10) | A, B, C complete, legible, verified on screen, in that order | 11, 13 |
| C2 Write-up (15) | architecture, context strategy, model setup, trade-offs, **an accurate scorecard with timestamps**, honest limitations | 13 |

Where a submission sits between two anchors, judges give the **lower** one. Half-built features score as if absent.
Finish one row at its top anchor before starting the next.

## Fixed tasks (exact wording, never paraphrase in tests or prompts)

- **A**: in `src/flask/helpers.py`, select `get_debug_flag` and instruct: *"Treat the values 'off' and 'n' as false as
  well, case-insensitively, and update the docstring to list every value that is treated as false."*
- **B**: with no files mentioned, instruct: *"Add a new built-in CLI command flask config that prints the loaded
  application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as
  "\*\*\*". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in
  commands."*
- **C**: give TrueForge an unreachable endpoint or an invalid key, then repeat A.

## Non-goals (time spent here is time lost)

Tab completion or fill-in-the-middle. Training or hosting a model. Any hosted backend, database or deployed service.
Accounts or auth. Marketplace publishing. A Code-OSS fork (that comes after Round 1; see `docs/BACKLOG.md`).
Telemetry of any kind.

## Priorities, in order

1. TrueForge round trip works end to end (spike).
2. Task A at its top anchor.
3. Task B at its top anchor.
4. Task C at its top anchor.
5. Latency tuning measured by the bench.
6. Polish.

If 3 is late, 5 and 6 are cut. Never the reverse.
