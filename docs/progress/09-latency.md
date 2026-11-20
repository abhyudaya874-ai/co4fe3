# 09 — latency: marks, pre-warm, delayed hedge, perf and overhead gates

## Instrumentation

- `Marks` on the inline path (enter / firstDelta / done / review) was already in place; `marks.line(model)` logs
  `perf ttft=… created=… total=… model=…` on every edit, and the status bar shows `⚡ <s> · <model>`.
- NEW: agent turns now carry a `Marks` too — `enter` → `session` → `created` → `firstDelta` → `firstTool` →
  `review` (first pause) → `done`. Line logged + pushed as a `latency` PanelEvent + status-bar TTFT. The panel
  renders it as a muted row.

## Pre-warm (lever 3)

- Inline: `sessions.warm("inline", order[0])` on command start — and now `order[1]` too when
  `latency.hedgeInline` is on.
- Panel: the composer posts `{ type: "focus" }` → `sessions.warm("agent", order[0])`. `sessions.agent()` now
  consumes the warm spare via `take("agent", model)` + `sessions.update` for the fresh spec/instructions, so a
  send never pays session-create latency when the spare exists.
- The `session` mark vs `enter` on a warm take is the human Dev-Host check (PENDING HUMAN, see below).

## Delayed hedge (lever 9)

- `latency/hedge.ts`: `hedged(a, b, delayMs)` — a leads if it streams first; b starts at `hedgeDelayMs`
  (p90×1.2, clamped 2.5–8 s, 4 s-ish unsampled) or at once if a fails before streaming; the loser is aborted.
- Router.inline: when `hedgeInline && order.length ≥ 2`, the first two models race; both lose → the remaining
  order continues through `runWithFallback`. `collectFailures` feeds the all-failed line.
- **Bug found in the rule-60 hedge code**: a leader that failed *after* winning left the promise unsettled
  (startB refuses once `leader` is set → hang). Fixed: a leader failure rejects the race. Added a regression
  test ("leader fails after winning → rejects, does not hang").
- UI follows one leader (`leader ??= model` on first text; non-leader text suppressed). `attempt`/`failed`/
  `answered` notes flow to the panel/banners exactly like the fallback path.
- `hedge.test.ts`: 7 tests, fake timer — all green.

## Rendering (lever 10)

- `applyPanelBatch` — one reducer pass per bridge batch; App dispatches the batch once (one React commit —
  React 18 auto-batching meant N dispatches were already one commit; the batch action is the explicit contract).
- `TextRow` renders a plain `<pre>` while `status === "running"`, markdown on done — no re-parse per frame.
- Bridge was already 33 ms + `React.memo` rows.

## Perf gates (all inside `npm run verify`, budgets × 2)

| Test | Budget | Median |
|---|---|---|
| index 400 files | < 3 s | 31 ms |
| rankFiles (4 channels) | < 100 ms | 2.5 ms |
| assemblePack | < 160 ms | ~0 ms |
| shapeSymbolPack | < 20 ms | ~0 ms |
| panel fold 10k events | < 400 ms | 37 ms |
| toHunks 5000-line file | < 40 ms | ~1 ms |
| rrfMerge 4×60 | < 2 ms | 0.01 ms |
| withinBudget quick-path start | exact at fullMs | pass |

## Overhead gate (`test/integration/overhead.test.ts`, real TrueForge + 0-latency fake model)

| Shape | Budget | Measured |
|---|---|---|
| Task A turn | < 1.2 s | **61 ms** (ttft 51, session 10) |
| Task B shape: 10 read_file + 2 auto-accepted propose_edit + 1 run_command | < 4 s | **157 ms** |

`nodeTestHost.run` implemented (exec + timeout + output cap) for the run_command leg.

## Live bench (`npm run bench:latency`, real keys, 2026-11-20)

```
model                                      ok   ttft p50  ttft p90  total p50  tok/s  tool
nvidia-nim/nemotron-super                  4/5   0.74 s    1.37 s    2.04 s    182   ok
google-gemini/gemini-flash-lite            5/5   2.04 s    2.43 s    2.04 s   1921   ok
```

Recommendation = the shipped order (nemotron primary for TTFT, gemini second for throughput). No order change.
Bench fix recorded honestly in docs/LATENCY.md: nemotron scored 0/5 at `maxTokens: 64` because it is a reasoning
model; 256 is the fair cap.

## PENDING THE HUMAN (Dev Host)

- Task A × 3 + Task B × 1 perf lines as the baseline (workflow §1).
- The warm-session check: `session` within 5 ms of `enter` on the second edit.
- The live hedge check: put the slower model first, `co4fe3: Reset model stats`, run an inline edit — both
  attempts should start and the leader's banner names the answering model.
