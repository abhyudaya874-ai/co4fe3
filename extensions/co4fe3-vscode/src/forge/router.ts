import type { TrueForge } from "@truefoundry/trueforge-sdk";
import type { AttemptUi } from "@co4fe3/agent-core";
import { runTurn, STREAM, type TurnOutcome, type TurnHooks } from "@co4fe3/agent-core";

export type InlineResult = Extract<TurnOutcome, { status: "done" }> | Extract<TurnOutcome, { status: "cancelled" }> | Extract<TurnOutcome, { status: "error" }>;

/** Model order, sessions and (from workflow 08) fallback and stats. Workflow 04 uses one model, no fallback. */
export class Router {
  private last: string | null = null;
  constructor(private getClient: () => TrueForge, private deps: { order: () => string[]; take: (mode: "inline" | "agent", model: string) => Promise<{ id: string; model: string }>; log: (l: string) => void }) {}

  /** The user's model order for this mode (workflow 08 adds stats-based reordering and benched models). */
  order(_mode: "inline" | "agent"): string[] { return this.deps.order(); }
  label(mode: "inline" | "agent"): string { return this.order(mode)[0] ?? "(no model configured)"; }
  lastModel(): string { return this.last ?? this.label("inline"); }
  currentModel(): string { return this.label("inline"); }

  /** One agent turn on the panel's chat session: tools enabled, pauses answered by the panel. */
  async agent(session: { id: string; model: string }, text: string, hooks: TurnHooks, signal: AbortSignal): Promise<TurnOutcome> {
    this.last = session.model;
    return await runTurn({ client: this.getClient(), sessionId: session.id, text, signal, hooks });
  }

  /** One inline-edit turn on a pre-warmed session: text only, no tools (rule 60, lever 1). */
  async inline(prompt: string, ui: AttemptUi, signal: AbortSignal): Promise<InlineResult> {
    const model = this.order("inline")[0];
    if (!model) return { status: "error", turnId: undefined, previousTurnId: null, message: "No model configured. Set co4fe3.models.order or run npm run setup:trueforge.", sawOutput: false };
    const { id } = await this.deps.take("inline", model);
    this.last = model;
    let acc = "";
    const out = await runTurn({
      client: this.getClient(), sessionId: id, text: prompt, signal,
      hooks: {
        onEvent: (e, index) => {
          if (e.type === "model.message.delta") {
            const base = index.get(e.id);
            const full = textOfModel(base);
            if (full !== null) { acc = full; ui.onText(acc, e.threadId); }
          } else if (e.type === "turn.update") {
            ui.onStatus(`Waiting for ${model}…`);
          }
          ui.onEvent?.(e);
        },
        onPause: async () => [],   // the inline agent has no tools: no pause is expected
      },
    });
    this.deps.log(`inline turn ${out.status}${out.status === "done" ? ` (${acc.length} chars)` : ""}`);
    if (out.status === "done") return { status: "done", turnId: out.turnId, output: out.output };
    return out;
  }
}

/** The merged text of a model.message event (string or parts; verified in the spike). */
function textOfModel(m: unknown): string | null {
  const c = (m as { content?: unknown } | undefined)?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p && typeof p === "object" && "text" in p && typeof p.text === "string" ? p.text : "")).join("");
  return null;
}

export { STREAM };
