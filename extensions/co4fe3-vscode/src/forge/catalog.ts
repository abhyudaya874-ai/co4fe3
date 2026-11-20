import type * as vscode from "vscode";
import type { TrueForge } from "@truefoundry/trueforge-sdk";
import { resolveModelOrder, realSleep, type ServedModel } from "@co4fe3/agent-core";

const PICK_KEY = "co4fe3.model.pick";
const RECENT_KEY = "co4fe3.model.recent";

/**
 * Which models TrueForge serves, which one the user picked in the chat, and which answered lately.
 * The pick and the recents live in globalState: choosing a model never writes a settings file (that would dirty the user's repo).
 */
export class ModelCatalog {
  private served_: ServedModel[] = [];
  private stop = new AbortController();

  constructor(
    private ctx: Pick<vscode.ExtensionContext, "globalState">,
    private getClient: () => TrueForge,
    private cfg: () => { models: { order: string[]; explicit: boolean } },
    private log: (l: string) => void,
    private onChange: () => void,
  ) {}

  get served(): readonly ServedModel[] { return this.served_; }
  get pick(): string | null { return this.ctx.globalState.get<string | null>(PICK_KEY, null); }
  get recent(): string[] { return this.ctx.globalState.get<string[]>(RECENT_KEY, []); }

  /** The order the router tries: the pick first, then the configured models, with a fallback behind. */
  order(): string[] {
    const c = this.cfg();
    return resolveModelOrder({ pick: this.pick, configured: c.models.order, explicit: c.models.explicit, served: this.served_.map((m) => m.name) });
  }

  setPick(name: string | null): void {
    void this.ctx.globalState.update(PICK_KEY, name);
    this.onChange();
  }

  /** A model answered a request here: it moves to the front of "Recently used". */
  noteAnswered(model: string): void {
    const next = [model, ...this.recent.filter((m) => m !== model)].slice(0, 5);
    if (next.join() !== this.recent.join()) void this.ctx.globalState.update(RECENT_KEY, next);
  }

  /** One `models.list`. A failure keeps the previous list. */
  async refresh(): Promise<boolean> {
    try {
      const { data } = await this.getClient().models.list({ timeoutInSeconds: 5, maxRetries: 0 });
      const next = data.map((m): ServedModel => ({ name: m.name, contextLength: m.properties?.contextLength }));
      const changed = JSON.stringify(next) !== JSON.stringify(this.served_);
      this.served_ = next;
      if (changed) this.onChange();
      return true;
    } catch (e) {
      this.log(`models.list failed: ${String(e).slice(0, 160)}`);
      return false;
    }
  }

  /** TrueForge may start after VS Code: keep asking, with backoff, until it answers once. Never awaited by activate(). */
  async discover(): Promise<void> {
    for (let attempt = 0; !this.stop.signal.aborted; attempt++) {
      if (await this.refresh()) return;
      await realSleep(Math.min(15_000, 1000 * 2 ** Math.min(attempt, 4)), this.stop.signal).catch(() => undefined);
    }
  }

  dispose(): void { this.stop.abort(); }
}
