---
description: Measure and tune latency - marks and the status-bar TTFT, pre-warmed sessions, the delayed hedge for inline edit, coalesced rendering, perf tests, the zero-latency-model overhead test, and the live bench
argument-hint: ""
---

# 09 Latency

Goal: every budget in rule 60 is measured, and green in `npm run verify`. The live bench table is in
`docs/LATENCY.md`. Inline edit on the real models starts streaming as early as the fastest healthy model allows.
**Measure before you tune, and tune one lever at a time.** Record before/after numbers for every change in
`docs/progress/09-latency.md`.

## 1. Instrument first

- Every inline edit and agent turn owns a `Marks` (rule 60). Mark `enter`, `session`, `created`, `firstDelta`,
  `firstTool`, `review`, `done` where they happen.
- At `done`: `out.info(marks.line(model))`, update the status bar item (`⚡ 1.4 s · gemini-flash-lite`), and push a
  `latency` PanelEvent.
- MCP handlers already log `perf mcp.<tool> <ms>` (workflow 02). Activation logs `perf activate <ms>`.

Run Task A three times and Task B once on the real models. Paste the `perf` lines. That is the baseline.

## 2. Pre-warm (lever 3)

- `sessions.warm("inline", order[0])` when the inline command starts (before the input box). Also warm `order[1]`
  when `hedgeInline` is on.
- `sessions.warm("agent", order[0])` when the composer gets focus (the webview sends `{ type: "focus" }`).
- After each use, `warm()` again, so one spare is always ready. Check: the `session` mark is within 5 ms of `enter`
  on the second edit.

## 3. Delayed hedge for inline edit (lever 9), on top of workflow 08's router

```ts
// Router.inline: hedge the first two healthy models, then fall back through the rest
const order = this.order("inline");
if (this.cfg().latency.hedgeInline && order.length >= 2) {
  let leader: string | null = null;
  const attempt = (model: string): Attempt<AttemptResult> => async (s, onFirst) => {
    const session = await this.pool.take("inline", model);
    try {
      ui.onNote({ kind: "attempt", model, n: 1 });
      const res = await attemptTurn({ client: this.client, sessionId: session.id, text: prompt, previousTurnId: "none", stallMs: stallMs(this.stats()[model]), model },
        { ...ui, onText: (t, th) => { onFirst(); leader ??= model; if (leader === model) ui.onText(t, th); } }, s);   // the UI follows one leader
      this.record(model, res);
      if (res.outcome.status === "done") return res;
      const failure = res.outcome.status === "error" ? classifyFailure(res.outcome.message) : classifyFailure("stall");
      ui.onNote({ kind: "failed", model, failure, next: model === order[0] ? order[1]! : null });
      throw new AttemptFailed(model, failure);
    } finally { this.pool.warm("inline", model); }
  };
  try {
    const { winner, value } = await hedged(attempt(order[0]!), attempt(order[1]!), hedgeDelayMs(this.stats()[order[0]!]), signal);
    const model = winner === "a" ? order[0]! : order[1]!;
    ui.onNote({ kind: "answered", model, fellBack: winner === "b" });
    return value.outcome.status === "done" ? { status: "done", output: value.outcome.output, model } : { status: "cancelled" };
  } catch (e) {
    if (signal.aborted) return { status: "cancelled" };
    if (order.length === 2) return { status: "error", message: allFailedLine(collectFailures(e)) };
    // else: continue with order.slice(2) through runWithFallback (workflow 08 code)
  }
}
```

Check it live without new settings. Put a slow model first in `co4fe3.models.order` (for example
`nvidia-nim/nemotron-ultra`), keep a fast one second, and run `co4fe3: Reset model stats` so the 4 s default delay
applies. Then run an inline edit and watch the output channel: both attempts start, one leads, the other logs
`cancelled`, and the banner says which model answered. Restore the order afterwards.

## 4. Rendering (lever 10)

- Each `Bridge` batch is one `postMessage` every 33 ms, of coalesced snapshots.
- In the webview, apply a whole batch in one reducer pass and one React commit (`useReducer` with a `batch` action).
- Rows are `React.memo` keyed by row id.
- The text row renders a plain `<pre>` while streaming and switches to the markdown renderer on `done`, so there is
  no re-parse per frame.

## 5. Perf tests (`packages/agent-core/test/perf/*.perf.test.ts`): 2× budgets, medians printed

```ts
import { it, expect } from "vitest";
import { synthRepo } from "./synth";                        // deterministic generator: synthRepo({ files, linesPerFile, seed })

it("indexes a 400-file repo in < 3 s and ranks in < 100 ms", () => {
  const files = synthRepo({ files: 400, linesPerFile: 50, seed: 7 });
  let t = performance.now();
  const ix = buildIndex(files.map(([p, s]) => indexFile(p, s)));
  const build = performance.now() - t;
  t = performance.now();
  rankFiles(ix, { text: "add a built-in cli command that prints config as json, with a test and docs", mentioned: [] });
  const rank = performance.now() - t;
  console.log(`perf index=${build.toFixed(0)}ms rank=${rank.toFixed(1)}ms`);
  expect(build).toBeLessThan(3000);
  expect(rank).toBeLessThan(100);
});

it("folds 10,000 panel events in < 400 ms", () => {
  const events = Array.from({ length: 10_000 }, (_, i): PanelEvent => ({ kind: "text", id: `m${i % 50}`, threadId: "main", text: "x".repeat(i % 300), reasoning: "" }));
  const t = performance.now();
  events.reduce(applyPanelEvent, emptyPanel());
  expect(performance.now() - t).toBeLessThan(400);
});
```

Also add:
- `hunks` on a 5,000-line file in < 40 ms;
- `assemblePack` in < 160 ms;
- `rrfMerge` over 4 × 60 ids in < 2 ms;
- `shapeSymbolPack` with 50 callers and 200 references in < 20 ms;
- `withinBudget` with a fake timer proving that the quick path starts exactly at `fullMs`.

## 6. Overhead with a zero-latency model (`test/integration/overhead.test.ts`)

```ts
it("Task-A-shaped turn costs < 1.2 s of our own time", async () => {
  const h = await startHarness(() => ({ text: "```python\nx = 1\n```", chunks: 4 }));
  const m = new Marks();
  m.mark("enter");
  const { data: s } = await h.client.sessions.create({ agent: { spec: buildSpec(INLINE_AGENT, { model: h.model, editorServer: h.mcpName }) } });
  m.mark("session");
  const r = await attemptTurn({ client: h.client, sessionId: s.id, text: "edit", stallMs: 5000, model: h.model }, { onText: () => m.mark("firstDelta"), onStatus: () => undefined }, new AbortController().signal);
  m.mark("done");
  console.log(m.line(h.model), `session=${m.span("enter", "session")}`);
  expect(r.outcome.status).toBe("done");
  expect(m.span("enter", "done")).toBeLessThan(1200);
  await h.close();
});
```

The Task-B-shaped case scripts 10 tool calls (pack-guided reads, 2 proposals auto-accepted by a test `onPause`, one
`run_command` of `node -e "process.exit(0)"`) and asserts < 4 s.

## 7. Live bench (`npm run bench:latency`, real keys, before recording)

The script is `scripts/bench-latency.mjs` (shipped in the pack; read `docs/LATENCY.md`). It runs through TrueForge
only. Paste its table into `docs/LATENCY.md`, and set `co4fe3.models.order` from its recommendation if that is
better than the current order.

## Exit check

- `npm run verify` green, with the perf and overhead tests inside it.
- Before/after numbers for each lever you touched are in `docs/progress/09-latency.md`.
- The bench table is in `docs/LATENCY.md`, with the date and the model list.
- Commit: `latency: marks, pre-warm, delayed hedge, perf and overhead gates`
