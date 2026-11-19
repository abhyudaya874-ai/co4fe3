---
trigger: always_on
description: Commit format, the dated timebox to the Round 1 deadline, the feature freeze, and what to cut first
---

# Commits and the clock

## Commit format (judges read the history)

```
<area>: <what changed, imperative, ≤ 60 chars>

Why: <the user-visible reason or the scoring row it serves>
Files: <n> (<the main ones>)
Verify: npm run verify → all stages passed
```

Areas: `core`, `forge`, `mcp`, `review`, `inline`, `panel`, `context`, `crew`, `models`, `latency`, `instr`,
`ext`, `test`, `docs`, `chore`. A commit does one thing, and the tree is green at every commit (a hook enforces it).

Example:

```
review: per-hunk CodeLens accept and reject on proposals

Why: A1/B2 top anchor needs per-hunk decisions in the editor
Files: 2 (extensions/co4fe3-vscode/src/review/hunkLens.ts, controller.ts)
Verify: npm run verify → all stages passed
```

## The timebox (IST). Re-planned Thu 19 Nov 2026, 20:15. The deadline is Fri 20 Nov, 23:59.

The pack was re-planned around V3Code's architecture at 20:15 on Thursday, so the clock starts there. The rows
assume the build runs overnight. If a human must sleep, the agent keeps working through rows that need no keys or
recording, and the human-only steps (keys, rehearsals, recording, uploads) move into the morning rows.

| When | Workflows | Exit check |
|---|---|---|
| Thu 19, by 23:00 | 00 bootstrap, 01 spike | a scripted turn calls our `read_file` through real TrueForge; failure strings recorded |
| Fri 20, by 03:00 | 02 MCP (incl. modes + turn policy), 03 review core (incl. verify) | approval → hunks → write → undo, in the integration tests |
| Fri 20, by 08:00 | 04 inline edit | Task A works on flask in the Extension Development Host |
| Fri 20, by 11:00 | 05 panel | streaming, tool cards, Stop, reviews, member rows in the panel |
| Fri 20, by 14:00 | 06 context (RRF, pack_context), 07 crew (profiles, evidence) | Task B: pack card with ranks, crew briefs/reports, 3+ files |
| Fri 20, by 16:00 | 08 fallback, 09 latency | Task C, plus the bench table |
| Fri 20, by 17:30 | 10 instructions (or its 20-line fallback), 11 rehearse | A, B, C rehearsed twice without a failure |
| **Fri 20, 18:00** | **FEATURE FREEZE** | from here, only fixes for things seen failing in a rehearsal |
| Fri 20, by 21:30 | 12 package, 13 submit | video recorded, write-up PDF exported, repo public |
| Fri 20, by 22:30 | links submitted | every link opens in a private window. The 90 minutes left are buffer, not work time. |

Behind by more than 2 hours at any row → cut from the list below, in order, and write what you cut in
`docs/BACKLOG.md`.

## Cut list (first to go at the top)

1. Workflow 10 (instructions in the product). Keep the AGENTS.md-only path, which is 20 lines.
2. The delayed hedge. Keep the stats, the status-bar TTFT and the stall watchdogs.
3. `pack_context`'s LSP side (`host/lsp.ts`). Keep the tool with its index fallback (`source: "index"`).
4. The board tools. The crew still works through briefs and reports.
5. The verify wait after an apply. Keep the baseline capture, and report "applied" without the new-errors line.
6. Ask/Plan modes. Ship Agent mode only; `toolsForMode` stays, and the chip is hidden.
7. The evidence check. Members end `completed` / `failed` from `thread.done` only.
8. `@symbol` autocomplete. Keep `@file`.
9. Webview polish (animations, the outline minimap). Keep plain, legible rows, including the pack card's rank chips.
10. e2e tests. Keep the integration tests.

**Never cut:** Task A, Task B, Task C, per-hunk accept/reject, Undo shown on screen, Stop with a consistent
workspace, automatic fallback, the context pack card with reasons and ranks, the turn policy (repeat and mistake
stops), the TrueForge session link, and the README setup from a clean clone.
