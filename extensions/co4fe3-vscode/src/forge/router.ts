import type { TrueForge, TrueForgeApi } from "@truefoundry/trueforge-sdk";
import type * as vscode from "vscode";
import type { AttemptUi, AgentSpec, AttemptResult, Note, TurnOutcome, TurnHooks } from "@co4fe3/agent-core";
import { attemptTurn, runWithFallback, classifyFailure, noteLine, allFailedLine, orderModels, emptyStat, record, stallMs, realSleep, type ModelStat } from "@co4fe3/agent-core";

export type InlineResult = Extract<TurnOutcome, { status: "done" }> | Extract<TurnOutcome, { status: "cancelled" }> | Extract<TurnOutcome, { status: "error" }>;
type Mode = "inline" | "agent";
interface Take { (mode: "inline" | "agent", model: string): Promise<{ id: string; model: string }> }

export interface RouterDeps {
  order: () => string[];                                  // cfg().models.order
  autoOrderInline: () => boolean;                         // cfg().latency.autoOrderInline
  take: Take;
  warm: (mode: "inline" | "agent", model: string) => void;
  specFor: (mode: "inline" | "agent" | "ask" | "plan", model: string) => AgentSpec;
  log: (l: string) => void;
}

/** Model order, sessions, stats and fallback (rule 70). runWithFallback does the state machine; this wires it. */
export class Router {
  private last: string | null = null;
  constructor(private ctx: Pick<vscode.ExtensionContext, "globalState">, private getClient: () => TrueForge, private deps: RouterDeps) {}

  private stats(): Record<string, ModelStat> { return this.ctx.globalState.get<Record<string, ModelStat>>("co4fe3.stats.v1", {}); }
  /** The user's order minus benched models; inline may re-order by measured p50 TTFT (rule 60 lever 8). */
  order(mode: Mode): string[] { return orderModels(this.deps.order(), this.stats(), Date.now(), mode === "inline" && this.deps.autoOrderInline()); }
  label(mode: Mode): string { return this.order(mode)[0] ?? "(no model configured)"; }
  lastModel(): string { return this.last ?? this.label("inline"); }
  currentModel(): string { return this.label("inline"); }
  benched(fqn: string): ModelStat | undefined {
    const s = this.stats()[fqn];
    return s && s.benchedUntil > Date.now() ? s : undefined;
  }
  stat(fqn: string): ModelStat | undefined { return this.stats()[fqn]; }
  resetStats(): void { void this.ctx.globalState.update("co4fe3.stats.v1", {}); }

  private record(model: string, r: AttemptResult): void {
    const all = { ...this.stats() }, cur = all[model] ?? emptyStat(model), o = r.outcome, now = Date.now();
    if (o.status === "done" && r.firstTokenMs !== null) all[model] = record(cur, { ok: true, ttftMs: r.firstTokenMs }, now);
    else if (o.status === "error") { const f = classifyFailure(o.message ?? "error"); all[model] = record(cur, { ok: false, benchMs: f.benchMs, error: f.detail }, now); }
    else if (o.status === "cancelled" && o.reason === "stall") all[model] = record(cur, { ok: false, benchMs: 60_000, error: "stall" }, now);
    void this.ctx.globalState.update("co4fe3.stats.v1", all);
  }

  /** One inline-edit turn: tries the model order, benches failures, hedging lands in workflow 09. */
  async inline(prompt: string, ui: AttemptUi & { onNote(n: Note): void }, signal: AbortSignal): Promise<InlineResult> {
    const models = this.order("inline");
    if (!models.length) return { status: "error", turnId: undefined, previousTurnId: null, message: "No model configured. Set co4fe3.models.order or run npm run setup:trueforge.", sawOutput: false };
    const r = await runWithFallback(models, async (model, _n, s) => {
      const session = await this.deps.take("inline", model);
      try {
        const res = await attemptTurn({ client: this.getClient(), sessionId: session.id, text: prompt, previousTurnId: "none", stallMs: stallMs(this.stats()[model]), model }, ui, s);
        this.record(model, res);
        return res;
      } finally { this.deps.warm("inline", model); }               // the next edit finds a session ready
    }, (n) => { ui.onNote(n); this.deps.log(noteLine(n)); }, signal, realSleep);
    if (signal.aborted) return { status: "cancelled", turnId: undefined, reason: "client-cancelled" };
    if (r.model === null) return { status: "error", turnId: undefined, previousTurnId: null, message: allFailedLine(r.failures), sawOutput: false };
    const o = r.result.outcome;
    this.last = r.model;
    this.deps.log(`inline turn ${o.status} model=${r.model}`);
    return o;
  }

  /** One agent turn on the panel's chat session: tools enabled, pauses answered by the panel, fallback via sessions.update. */
  async agent(session: { id: string; model: string }, text: string, hooks: TurnHooks & { onNote?(n: Note): void }, signal: AbortSignal): Promise<TurnOutcome> {
    let prev: string | undefined;
    let lastOutcome: TurnOutcome | undefined;
    const r = await runWithFallback(this.order("agent"), async (model, _n, s) => {
      if (session.model !== model) {                            // same chat session, different model (rule 20 trap 7)
        await this.getClient().sessions.update(session.id, { agent: { spec: this.deps.specFor("agent", model) as TrueForgeApi.AgentSpec } }, { timeoutInSeconds: 15, maxRetries: 0 });
        session.model = model;
      }
      const res = await attemptTurn({
        client: this.getClient(), sessionId: session.id, text,
        previousTurnId: prev, stallMs: stallMs(this.stats()[model]), model,
      }, { onText: () => undefined, onStatus: () => undefined, onEvent: hooks.onEvent, onPause: hooks.onPause }, s);
      this.record(model, res);
      lastOutcome = res.outcome;
      if (res.outcome.status === "error" || (res.outcome.status === "cancelled" && res.outcome.reason === "stall"))
        prev = (res.outcome as { previousTurnId?: string | null }).previousTurnId ?? prev;   // the retry replaces the failed turn (rule 20, trap 7)
      return res;
    }, (n) => { hooks.onNote?.(n); this.deps.log(noteLine(n)); }, signal, realSleep);
    if (r.model === null)
      return lastOutcome?.status === "error" ? { ...lastOutcome, message: allFailedLine(r.failures) } : { status: "error", turnId: undefined, previousTurnId: prev ?? null, message: allFailedLine(r.failures), sawOutput: false };
    this.last = r.model;
    return r.result.outcome;
  }
}
