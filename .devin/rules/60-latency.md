---
trigger: always_on
description: Latency budgets for every user-visible step, the design levers that meet them, adaptive model order from measured time-to-first-token, delayed hedging, and how latency is tested
---

# Latency

A fast agent is mostly one that makes **fewer model round trips** and **never makes the user wait on our own code**.
Model speed is outside our control (and judges may swap the model). Our overhead is not, so it has hard budgets that
tests enforce. `docs/LATENCY.md` explains how to read the numbers. The `latency-probe` skill runs the measurements.

## Budgets (p95 unless marked; Extension Development Host on the dev laptop; flask 3.1.3 open)

| Step | Budget | Measured by |
|---|---|---|
| `activate()` returns | 150 ms | `perf` log line `activate` |
| Ctrl+Alt+K → input box visible | 50 ms | manual + `perf inline.open` |
| Enter → `turn.created` (inline) | 400 ms | `Marks` enter→created |
| first model delta → visible in the diff editor | 60 ms | `Marks` firstDelta→painted (proposal doc update) |
| `turn.done` → hunks + CodeLens shown | 100 ms | `Marks` done→review |
| Send → context pack card shown | 250 ms (index warm); hard cap 800 ms full + 200 ms quick (rule 40) | `perf agent.pack path=<full|quick|none>` |
| MCP `pack_context` (LSP answering) | 400 ms | `perf mcp.pack_context` |
| delta → painted in the panel | 50 ms | bridge batch interval (33 ms) + React commit |
| Stop → panel shows "Stopped" | 100 ms | integration test |
| MCP `read_file` / `find_symbol` / `repo_map` | 30 / 30 / 80 ms | handler timer, `perf mcp.<tool>` |
| `propose_edit` handler incl. verify wait | 1,700 ms worst case (1,500 ms diagnostics wait, returns early on change) | `perf mcp.propose_edit` |
| MCP `search_workspace` | 300 ms | same |
| **Harness overhead, Task-A-shaped turn, fake model with zero latency** | **1.2 s** end to end | `test/integration/overhead.test.ts` |
| **Harness overhead, scripted Task-B-shaped turn (10 tool calls, 2 reviews auto-accepted)** | **4 s** | same |
| Index build, cold, flask (~17k lines) | 1.5 s, in the background | `perf index.build` |
| Re-index one saved file | 20 ms | `perf index.update` |

The two overhead rows are the ones that matter most. They hold model time at zero, so they measure exactly what
co4fe3 adds: TrueForge, MCP, review and rendering.

## The levers, in order of payoff (each one is a decision in `docs/DECISIONS.md`)

1. **Inline edit is ONE model call.** No tools. The model streams the replacement for the selected lines in one
   fenced block, which the diff editor shows live. A tool loop would be 2+ calls (propose, then a final message).
2. **Preload our editor tools** (`preload: true` on our MCP server). With deferred loading, every first use of a tool
   costs `list_tools` → `get_tool_info` → `call_tool`, and **each is a full model round trip**. Our server has 11 small
   tools, so preloading costs about 2.2k tokens and saves seconds. Any MCP server the user adds stays deferred.
   Tools are registered **read-first**: `repo_map`, `search_workspace`, `find_symbol`, `pack_context`, `read_file`
   first, then `propose_edit` and `run_command` (the `TOOLS` order in `runtime/modes.ts`). Models treat list
   position as priority, and V3Code measured that a locator listed last is never used (`availableTools`).
3. **Pre-warmed sessions.** A session is created when the inline input box opens and when the composer gets focus,
   while the user is still typing. One spare session per mode is kept ready.
4. **The context pack in the first message** saves the agent its first 3–6 search/read round trips (rule 40).
5. **Parallel work**: `parallelToolCalls: true`, and explorers as parallel subagents (rule 50).
6. **Short outputs**: inline `maxTokens: 2048`, `temperature: 0`. The agent's own text stays terse (its instructions
   say so). `reasoningEffort: "low"` only on models that list it.
7. **A stable prompt prefix**: instructions and tool definitions never change within a session. The volatile parts
   (pack, request) come last, so providers that cache prefixes can reuse them.
8. **Adaptive model order** from measured time-to-first-token (TTFT), with failing models benched (below).
9. **Delayed hedge, inline edit only**: if the first model has not streamed after `hedgeDelayMs`, the same request
   starts on the next model; the first to stream wins and the other is cancelled. This is safe because nothing is
   written before review. Agent mode never hedges (tools have side effects), but it falls back on a stall (rule 70).
10. **Rendering**: events are coalesced every 33 ms and sent as snapshots keyed by id (a newer snapshot replaces the
    older one). Rows are `React.memo`. The full transcript is never re-sent.
11. **Retrieval never holds the first token hostage** (V3Code's `retrieveWithinChatBudget`): full pack within
    800 ms, else a lexical-only pack within 200 ms, else no pack (rule 40).
12. **Fewer failed round trips**:
    - `planEdit` reports every bad edit at once (rule 30);
    - `TurnPolicy` stops repeat loops at the 5th identical call (rule 50);
    - `pack_context` replaces 4–6 read/search calls for one symbol (rule 40).

    Each failed or repeated call is a full model round trip saved.
13. **Watchdogs, not waiting** (V3Code's stream watchdog): no first token within `stallMs`, or no event at all for
    `IDLE_STALL_MS` (45 s) after streaming began, means the call is stalled. Agent mode falls back if nothing has run
    yet (rule 70). The idle timer is **paused while a review waits for the user**, because a person reading a diff is
    not a stall.

## Measured stats and model order (`agent-core/src/latency/stats.ts`)

```ts
export interface ModelStat { fqn: string; ttft: number[]; ok: number; fail: number; benchedUntil: number; lastError?: string }
export const emptyStat = (fqn: string): ModelStat => ({ fqn, ttft: [], ok: 0, fail: 0, benchedUntil: 0 });

export function record(s: ModelStat, r: { ok: true; ttftMs: number } | { ok: false; benchMs: number; error: string }, now: number): ModelStat {
  return r.ok
    ? { ...s, ttft: [...s.ttft, r.ttftMs].slice(-20), ok: s.ok + 1 }
    : { ...s, fail: s.fail + 1, benchedUntil: Math.max(s.benchedUntil, now + r.benchMs), lastError: r.error };
}
export function percentile(xs: readonly number[], p: number): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]!;
}
/** The user's order minus benched models (all benched → user's order: try anyway). `byLatency` reorders healthy models with ≥3 samples by p50 TTFT. */
export function orderModels(prefs: readonly string[], stats: Readonly<Record<string, ModelStat>>, now: number, byLatency: boolean): string[] {
  const healthy = prefs.filter((m) => (stats[m]?.benchedUntil ?? 0) <= now);
  const base = healthy.length ? healthy : [...prefs];
  if (!byLatency) return base;
  const p50 = (m: string) => (stats[m] && stats[m]!.ttft.length >= 3 ? percentile(stats[m]!.ttft, 50)! : Number.POSITIVE_INFINITY);
  return [...base].sort((a, b) => p50(a) - p50(b) || base.indexOf(a) - base.indexOf(b));
}
/** Start the hedge at this model's p90 TTFT, clamped to [2.5 s, 8 s]; 4 s until there are 3 samples. */
export function hedgeDelayMs(s: ModelStat | undefined): number {
  const p90 = s && s.ttft.length >= 3 ? percentile(s.ttft, 90)! : 4000;
  return Math.min(8000, Math.max(2500, Math.round(p90 * 1.2)));
}
/** No first token by this time = stalled: cancel and fall back. Twice p90, clamped to [8 s, 20 s]; 12 s until sampled. */
export function stallMs(s: ModelStat | undefined): number {
  const p90 = s && s.ttft.length >= 3 ? percentile(s.ttft, 90)! : 6000;
  return Math.min(20_000, Math.max(8000, p90 * 2));
}
/** After the first token: no TrueForge event at all for this long = stalled (reset on EVERY event, paused during a review). */
export const IDLE_STALL_MS = 45_000;
```

`byLatency` is on for inline edit (`co4fe3.latency.autoOrderInline`, default true) and off for agent mode. There,
the strongest model matters more than the fastest one. Stats live in `ExtensionContext.globalState` under
`co4fe3.stats.v1`.

## Delayed hedge (`agent-core/src/latency/hedge.ts`). Pure orchestration, injected clock.

```ts
export type Attempt<T> = (signal: AbortSignal, onFirstToken: () => void) => Promise<T>;

/** Starts `a`. Starts `b` after `delayMs` if `a` has not streamed yet, or at once if `a` fails before streaming.
 *  The first attempt to stream "leads": the other is aborted. Resolves with the leader's result. */
export function hedged<T>(a: Attempt<T>, b: Attempt<T> | null, delayMs: number, outer: AbortSignal, timer: Timer = realTimer): Promise<{ winner: "a" | "b"; value: T }> {
  return new Promise((resolve, reject) => {
    const ca = new AbortController(), cb = new AbortController();
    let leader: "a" | "b" | null = null, startedB = false, failures = 0, lastErr: unknown;
    const kill = () => { ca.abort(); cb.abort(); };
    outer.addEventListener("abort", kill, { once: true });
    const lead = (who: "a" | "b") => () => { if (leader) return; leader = who; (who === "a" ? cb : ca).abort(); };
    const settle = (who: "a" | "b") => (p: Promise<T>) => p.then(
      (value) => { if (leader === null || leader === who) { leader = who; kill(); resolve({ winner: who, value }); } },
      (err) => { lastErr = err; if (++failures === (startedB ? 2 : 1) && (startedB || !b)) reject(lastErr); else if (who === "a" && !startedB) startB(); });
    const startB = () => { if (!b || startedB || leader || outer.aborted) return; startedB = true; settle("b")(b(AbortSignal.any([cb.signal, outer]), lead("b"))); };
    settle("a")(a(AbortSignal.any([ca.signal, outer]), lead("a")));
    const t = timer.set(startB, delayMs);
    outer.addEventListener("abort", () => timer.clear(t), { once: true });
  });
}
```

Tests (`latency/hedge.test.ts`, fake timer): `a` streams before the delay, so `b` never starts. `a` is silent, so `b`
starts at the delay, streams first and `a` is aborted. `a` fails early, so `b` starts at once. Both fail, so it rejects
with the last error. An outer abort aborts both and calls no `resolve`.

The UI follows only the leader. Before a leader exists, the inline status reads "Waiting for <model>…
(<n> s)". When `b` takes over it reads "Answered by <model> (first model was slow)".

## Marks: every turn carries its own timings (`agent-core/src/latency/marks.ts`)

```ts
export type MarkName = "enter" | "session" | "created" | "firstDelta" | "firstTool" | "review" | "done";
export class Marks {
  private t = new Map<MarkName, number>();
  constructor(private now: () => number = () => performance.now()) {}
  mark(n: MarkName): void { if (!this.t.has(n)) this.t.set(n, this.now()); }   // first occurrence wins
  span(a: MarkName, b: MarkName): number | null { const x = this.t.get(a), y = this.t.get(b); return x === undefined || y === undefined ? null : Math.round(y - x); }
  line(model: string): string { return `perf ttft=${this.span("enter", "firstDelta")} created=${this.span("enter", "created")} total=${this.span("enter", "done")} model=${model}`; }
}
```

After each turn: the status bar shows `⚡ 1.4 s · gemini-flash-lite` (TTFT). The output channel logs `marks.line()`.
`record()` updates the stats.

## How latency is tested (details in rule 80 and `docs/LATENCY.md`)

1. **Unit** (`npm run verify:fast`): `stats`, `hedge`, `coalesce`, and the budget arithmetic. Deterministic, fake clock.
2. **Perf** (`npm run verify`): index/rank/pack/hunks/reducer on a generated 400-file repo, asserted against the
   budgets above × 2 (so CI noise cannot flake them). Medians are printed for the write-up.
3. **Overhead** (`npm run verify`): a real TrueForge plus the fake model at 0 ms, for the two overhead rows.
4. **Live** (`npm run bench:latency`, before recording): through TrueForge, for each configured model, 5 tiny
   turns and 1 tool-call probe. It prints a TTFT p50/p90, tokens/s and tool-call-ok table and the recommended
   primary/fallback. It never calls a provider directly.
