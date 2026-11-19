# LATENCY

How co4fe3 measures speed, and what the numbers mean. Rule 60 has the budgets and levers; the `latency-probe` skill
has the procedure.

## Three numbers, three owners

| Number | Owner | How we move it |
|---|---|---|
| **Our overhead**: everything except the model (TrueForge hop, MCP, review, rendering) | us | the code; enforced by `test/integration/overhead.test.ts` with a zero-latency fake model |
| **Round trips**: how many model calls a task needs | us (design) | inline = 1 call; preloaded tools; the context pack in the first message; parallel explorers |
| **Model time**: TTFT and tokens/s of one call | the provider | choose and order models from measurements; hedge inline edits; bench slow models |

A judge sees overhead × round trips + model time. We cut the first two to the bone and choose the third with data.

## Reading a `perf` line

```
perf ttft=1430 created=212 total=4870 model=google-gemini/gemini-flash-lite
```

- `created`: Enter to `turn.created`. This is our overhead plus TrueForge's. Budget 400 ms.
- `ttft`: Enter to the first token on screen. This is what the user feels.
- `total`: Enter to `turn.done`.

`perf mcp.read_file 4ms` is one tool handler. `perf index.build 820ms files=412` is the background index.

## Live bench results (fill in from `npm run bench:latency` before recording)

Date: ____  TrueForge: ____  Runs per model: 5  Machine: ____

| model | ok | TTFT p50 | TTFT p90 | total p50 | tok/s | tool probe |
|---|---|---|---|---|---|---|
| nvidia-nim/nemotron-super | | | | | | |
| google-gemini/gemini-flash-lite | | | | | | |

Recommended order: ____. Chosen order: ____ (say why if it differs).

Earlier measurements from UltraPals (Nov 2026, direct, not through TrueForge), for orientation only:

- Gemini 3.5 Flash-Lite answered in 0.8–2 s and allows 15 requests/min per model;
- NIM Nemotron models gave usable answers in 3.5–9 s and accepted 8 parallel requests;
- free OpenRouter models allow 50 requests/day without credits.

## Overhead results (from `npm run verify`)

| Case | Budget | Median of 3 |
|---|---|---|
| Task-A-shaped turn, 0 ms model | 1.2 s | |
| Task-B-shaped turn, 10 tool calls, 0 ms model | 4 s | |
| index build, flask | 1.5 s | |
| rank + pack, flask, Task B prompt | 250 ms | |
| pack path used on the first Task B send (full / quick / none) | full | |
| `pack_context` with the Python language server | 400 ms | |
| `propose_edit` handler incl. the verify wait | 1,700 ms | |

## Lever log (one row per experiment, from `docs/progress/09-latency.md`)

| Lever | Row | Before | After | Kept? |
|---|---|---|---|---|
| | | | | |
