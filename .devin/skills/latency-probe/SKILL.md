---
name: latency-probe
description: Measure co4fe3 latency properly - read the perf lines, run the perf and overhead tests, run the live bench through TrueForge, compare against the rule 60 budgets, and change one lever at a time
argument-hint: "[inline|agent|mcp|bench|all]"
agent: forge-verifier
triggers:
  - user
  - model
---

Probe: $ARGUMENTS

## 1. Where the numbers come from

| Number | Source | Command |
|---|---|---|
| TTFT, created, total per turn | `Marks.line()` in the co4fe3 output channel | Task A/B in the Extension Development Host, then read the `perf ttft=` lines |
| MCP handler time | `perf mcp.<tool> <ms>` lines | same |
| activation, index build | `perf activate`, `perf index.build` | reload the window |
| pure functions vs budget | perf tests | `npx vitest run --project perf` |
| our overhead with a 0 ms model | overhead test | `npx vitest run --project integration test/integration/overhead.test.ts` |
| real models through TrueForge | live bench | `npm run bench:latency` |

## 2. Procedure

1. **Baseline**: 3× Task A and 1× Task B on the real models. Copy every `perf` line into
   `docs/progress/09-latency.md` under "baseline <time>".
2. **Compare** each number with its rule 60 budget. List only the rows over budget.
3. **Choose one lever** from rule 60 that targets that row. Say why it should help, as one sentence with the mechanism
   (for example: "deferred tools cost 3 model calls before the first read_file; preloading removes them").
4. **Change it, re-measure the same way and record after/before.** Keep it only if the median improved by ≥ 10% and
   no other row regressed.
5. Repeat. Never stack two levers in one measurement.

## 3. Reading the live bench

`npm run bench:latency` prints a table of TTFT p50/p90, total p50, tokens/s and the tool-call probe for each model in
`config/providers.example.json` `order`, plus every model TrueForge lists:

- **TTFT** is what users feel in inline edit. Rank inline models by p50 TTFT (the router already does this once it
  has 3 samples).
- **The tool probe** must say `ok` for a model to lead agent mode. A fast model that cannot call tools is
  inline-only.
- **A high p90/p50 ratio** (> 3) means the model is unstable under free-tier load, so it belongs in fallback, not
  primary.
- Free tiers rate-limit the bench itself. The script paces Gemini at ≥ 4.5 s between calls. Do not run it in a loop.

## 4. Output contract

```
ROW:     <budget row>   BUDGET: <x>   BEFORE: <median, n>   AFTER: <median, n>
LEVER:   <rule 60 lever #> — <one-sentence mechanism>
VERDICT: keep | revert   (≥10% better and nothing else worse?)
```
