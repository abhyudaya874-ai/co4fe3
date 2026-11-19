---
name: judge-mode
description: Score the current build like a Forge-a-thon judge - pick the anchor each criterion actually reaches from evidence, give the lower anchor when in doubt, and list the cheapest moves to the next anchor
argument-hint: "[video timestamp file or 'live']"
agent: forge-reviewer
triggers:
  - user
  - model
---

Judge: $ARGUMENTS

Use only evidence you can point to: a video timestamp, a test name, a progress-file line, or something you watched in
the Extension Development Host. A feature that is "implemented" but not shown working earns nothing. Between two
anchors, always give the **lower** one.

## Score sheet (anchor values are fixed by the organisers)

| Criterion | Anchors | Evidence | Anchor reached |
|---|---|---|---|
| Gate | TrueForge loop · MCP tools · local mode · model in TrueForge · no direct provider calls · session shown · agent definition in repo | | pass / FAIL |
| A1 Inline edit | 0 · 4 no diff · 7 accept-all only · 10 per-hunk | | |
| A2 Agent mode | 0 · 4 one file · 7 user named files · 10 3+ files discovered | | |
| A3 Streaming/cancel | 0 blocks · 4 no cancel · 7 half-applied possible · 10 immediate + consistent | | |
| B1 Context | 0 concat · 5 @ only · 10 auto + stated · 15 + budget + visible in Task B | | |
| B2 Diff safety | 0 silent · 5 full-file preview · 10 per-hunk + undo shown | | |
| B3 Resilience | 0 hang/trace/files changed · 4 clear msg · 7 retry+backoff · 10 auto fallback | | |
| B4 TrueForge depth | 4 sessions only · 7 MCP + approval drives review · 10 + context feature visible | | |
| C1 Video | 0 missing/out of order · 5 not legible/verified · 10 complete + verified | | |
| C2 Write-up | 0 · 5 features only · 10 architecture + strategy + models + trade-offs · 15 + accurate scorecard + honest limits | | |

## Output contract

```
TOTAL: <n>/100   (gate: pass|FAIL)
LOWEST-HANGING: <criterion — current anchor → next anchor — the cheapest change that earns it — hours>
RISKS: <anything a judge could read as the lower anchor, and how to make it unambiguous on screen>
```
