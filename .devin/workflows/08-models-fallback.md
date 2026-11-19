---
description: Task C - providers in TrueForge, failure classification from real strings, one attempt with a stall timer, automatic fallback with backoff, persisted model stats, clear banners, and the model picker
argument-hint: ""
---

# 08 Models and fallback (Task C, B3 at "automatic fallback, no user action, workspace unchanged")

Goal: with the primary's key broken in TrueForge, Task A still produces a diff from the fallback without any user
action. A banner names what failed and who answered, and `git status` stays clean. With both models broken, a
clear sentence explains why, and nothing changes. Rule 70 is the spec; this workflow wires it.

## 1. Providers

Fill `config/providers.example.json` (it ships in the repo, with no keys) and run `npm run setup:trueforge`. Check
each model's context length against its model card and correct the placeholders. Paste the printed FQN list into
`docs/progress/08-models.md`.

## 2. One attempt, vscode-free (`agent-core/src/forge/attempt.ts`), so integration tests can run it

```ts
export interface AttemptUi { onText(full: string, threadId: string): void; onStatus(s: string): void; onEvent?(e: TfEvent, index: EventIndex): void; onPause?: TurnHooks["onPause"] }

/**
 * runTurn + two watchdogs (V3Code's stream watchdog, rule 60 lever 13):
 *  - first token: none within `stallMs` → stall;
 *  - idle: after the first token, no event at all for `idleMs` → stall. Reset on EVERY event; paused while a review waits for the user.
 * A stall aborts the attempt and returns { cancelled, reason: "stall" } so the router can fall back.
 */
export async function attemptTurn(a: { client: TrueForge; sessionId: string; text: string; previousTurnId?: string; stallMs: number; idleMs?: number; model: string }, ui: AttemptUi, signal: AbortSignal, now = () => performance.now()): Promise<AttemptResult> {
  const ac = new AbortController();
  const onOuter = () => ac.abort();
  signal.addEventListener("abort", onOuter, { once: true });
  const t0 = now();
  let first: number | null = null, stalled = false, sideEffects = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const stallNow = () => { stalled = true; ac.abort(); };
  const armIdle = () => { clearTimeout(idle); idle = setTimeout(stallNow, a.idleMs ?? IDLE_STALL_MS); };
  const firstToken = setTimeout(() => { if (first === null) stallNow(); }, a.stallMs);
  const tick = setInterval(() => { if (first === null) ui.onStatus(`Waiting for ${a.model}… ${Math.round((now() - t0) / 1000)} s`); }, 1000);
  try {
    const outcome = await runTurn({ client: a.client, sessionId: a.sessionId, text: a.text, previousTurnId: a.previousTurnId, signal: ac.signal, hooks: {
      onEvent: (e, index) => {
        if (first !== null) armIdle();                                  // any event proves the stream is alive
        if (e.type === "model.message" || e.type === "model.message.delta") {
          const m = index.get(e.id);
          const t = m?.type === "model.message" ? textOf(m.content) : "";
          if (t || (m?.type === "model.message" && m.toolCalls?.length)) {
            if (first === null) { first = now() - t0; clearTimeout(firstToken); armIdle(); }
            if (t) ui.onText(t, m!.type === "model.message" ? m.threadId : "main");
          }
        }
        ui.onEvent?.(e, index);
      },
      onPause: async (pending, index, s) => {
        clearTimeout(idle);                                              // a person reading a diff is not a stall
        try {
          const answers = ui.onPause ? await ui.onPause(pending, index, s) : pending.map((p) => deny(p, "This mode has no tools."));
          if (answers.some((x) => x.type === "user.tool_approval" && x.approval.status === "allow")) sideEffects = true;
          return answers;
        } finally { if (first !== null) armIdle(); }
      },
    } });
    return { outcome: stalled ? { status: "cancelled", turnId: undefined, reason: "stall" } : outcome, sideEffects, firstTokenMs: first };
  } finally { clearTimeout(firstToken); clearTimeout(idle); clearInterval(tick); signal.removeEventListener("abort", onOuter); }
}
```

Tests for both watchdogs (`attempt.test.ts`, fake timers, fake SDK client):

- no event at all → stall at `stallMs`;
- a first token, then silence → stall at `idleMs`;
- a pause that lasts 5 × `idleMs` while the user reviews → no stall;
- a steady stream → no stall.

## 3. The router (`extensions/…/src/forge/router.ts`): stats, order, sessions, banners

```ts
export class Router {
  constructor(private ctx: vscode.ExtensionContext, private client: TrueForge, private cfg: () => Config, private pool: SessionPool, private out: vscode.LogOutputChannel) {}
  private stats(): Record<string, ModelStat> { return this.ctx.globalState.get<Record<string, ModelStat>>("co4fe3.stats.v1", {}); }
  order(mode: "inline" | "agent"): string[] { return orderModels(this.cfg().models.order, this.stats(), Date.now(), mode === "inline" && this.cfg().latency.autoOrderInline); }

  async inline(prompt: string, ui: AttemptUi & { onNote(n: Note): void }, signal: AbortSignal): Promise<InlineResult> {
    const r = await runWithFallback(this.order("inline"), async (model, _n, s) => {
      const session = await this.pool.take("inline", model);
      try {
        const res = await attemptTurn({ client: this.client, sessionId: session.id, text: prompt, previousTurnId: "none", stallMs: stallMs(this.stats()[model]), model }, ui, s);
        this.record(model, res);
        return res;
      } finally { this.pool.warm("inline", model); }               // the next edit finds a session ready
    }, (n) => { ui.onNote(n); this.out.info(noteLine(n)); }, signal);
    if (signal.aborted) return { status: "cancelled" };
    if (r.model === null) return { status: "error", message: allFailedLine(r.failures) };
    const o = r.result.outcome;
    return o.status === "done" ? { status: "done", output: o.output, model: r.model } : { status: "cancelled" };
  }

  private record(model: string, r: AttemptResult): void {
    const all = { ...this.stats() }, cur = all[model] ?? emptyStat(model), o = r.outcome, now = Date.now();
    if (o.status === "done" && r.firstTokenMs !== null) all[model] = record(cur, { ok: true, ttftMs: r.firstTokenMs }, now);
    else if (o.status === "error") { const f = classifyFailure(o.message); all[model] = record(cur, { ok: false, benchMs: f.benchMs, error: f.detail }, now); }
    else if (o.status === "cancelled" && o.reason === "stall") all[model] = record(cur, { ok: false, benchMs: 60_000, error: "stall" }, now);
    void this.ctx.globalState.update("co4fe3.stats.v1", all);
  }
}
```

Agent mode (`router.agent`) uses the same `runWithFallback`, with one session for the whole chat. Before each
attempt, if the session's model is not `model`, call
`client.sessions.update(session.id, { agent: { spec: buildSpec(...) } })`. Retries use `previousTurnId` from the
failed outcome (rule 20, trap 7). `sideEffects` comes from `attemptTurn`, so a failure after an approved edit is
never retried automatically. The banner offers **Retry on <next model>** instead.

## 4. Session pool (`extensions/…/src/forge/sessions.ts`)

```ts
export class SessionPool {
  private ready = new Map<string, Promise<string>>();                 // "inline:<fqn>" → session id
  constructor(private client: TrueForge, private specFor: (mode: "inline" | "agent", model: string) => TrueForgeApi.AgentSpec) {}
  warm(mode: "inline" | "agent", model: string): void {
    const k = `${mode}:${model}`;
    if (!this.ready.has(k)) this.ready.set(k, this.create(mode, model).catch((e) => { this.ready.delete(k); throw e; }));
  }
  async take(mode: "inline" | "agent", model: string): Promise<{ id: string }> {
    const k = `${mode}:${model}`, p = this.ready.get(k) ?? this.create(mode, model);
    this.ready.delete(k);
    try { return { id: await p }; } catch { return { id: await this.create(mode, model) }; }   // one fresh retry
  }
  private async create(mode: "inline" | "agent", model: string): Promise<string> {
    const { data } = await this.client.sessions.create({ agent: { spec: this.specFor(mode, model) } }, ONCE);
    return data.id;
  }
}
```

## 5. What the user sees

- Inline: the notification line reads "Waiting for nvidia-nim/nemotron-super… 3 s". After a fallback, a non-modal
  `showWarningMessage` gives the rule 70 banner. If every model failed, a `showErrorMessage` offers
  `[Retry] [Open TrueForge settings]`. The latter opens `http://localhost:8790` with `vscode.env.openExternal`.
- Panel: a `model` row with the same sentence, in the transcript where it happened.
- The status bar model item shows `⚠` while the primary is benched. Its tooltip says until when, and why.
- Picker: `co4fe3.pickModel` shows QuickPicks of `client.models.list()` FQNs. Each row's description shows its
  stats (`p50 1.2 s · 14 ok · benched 3 min`). The picks write `co4fe3.models.order`.

## 6. Tests

- `fallback.test.ts`:
  - `classifyFailure`, using the **spike's recorded strings** plus synthetic ones for each kind;
  - `retryAfterMs`;
  - `runWithFallback` scenarios with a scripted `runOn`: a 401 moves to the next model with no retry; a 500 retries
    once and then moves on; a stall moves on; a side effect stops with no retry; all fail returns the failures in
    order; Stop does not move to the next model and emits no "answered" note.
- `integration/fallback.test.ts`: fake A answers `{ fail: 401, message: "invalid api key" }` and fake B answers text.
  `attemptTurn` + `runWithFallback` return B, the files are unchanged, and the order of notes is attempt(A) →
  failed(A) → attempt(B) → answered(B). Then make A `{ hang: true }` with `stallMs: 1500` and expect the same order,
  with a stall.

## 7. Task C rehearsal (Extension Development Host on flask)

Follow the rule 70 checklist step by step. Then restore the key: `npm run setup:trueforge`. In the Development Host,
run `co4fe3: Reset model stats` so the primary is no longer benched.

## Exit check

- Unit and integration fallback tests green.
- The Task C checklist passes twice in a row. The banner wording is pasted into `docs/progress/08-models.md`.
- Commit: `models: automatic fallback with stall detection, stats and clear banners`
