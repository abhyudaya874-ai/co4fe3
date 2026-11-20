import * as vscode from "vscode";
import type { LayoutId } from "@co4fe3/agent-core/panel";

/**
 * Agent mode fills the window with the chat: the activity bar, status bar, editor tabs and layout buttons are hidden.
 * VS Code has no per-window API for that, so these are user settings. They are backed up before the first change and put back
 * exactly (a value that was unset is unset again) when Agent mode ends, when its tab is closed, on deactivate, and, if the
 * window died in Agent mode, on the next activation.
 */
const HIDE: readonly (readonly [string, unknown])[] = [
  ["workbench.activityBar.location", "hidden"],
  ["workbench.statusBar.visible", false],
  ["workbench.editor.showTabs", "none"],
  ["workbench.layoutControl.enabled", false],
];
const BACKUP_KEY = "co4fe3.layout.backup.v1";
const MAX_BACKUP_AGE_MS = 12 * 3_600_000;
type Saved = { had: boolean; value: unknown };
interface Backup { pid: number; at: number; values: Record<string, Saved> }

export interface LayoutHooks {
  hideChrome(): boolean;
  openAgentWindow(): void;
  closeAgentWindow(): void;
  /** Reveal the chat beside the editor. */
  showDock(): Thenable<unknown>;
  log(line: string): void;
  onChange(layout: LayoutId): void;
}

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }   // EPERM: the process exists, we may not signal it
};

export class LayoutController {
  private current_: LayoutId = "editor";
  private queue: Promise<void> = Promise.resolve();

  constructor(private ctx: Pick<vscode.ExtensionContext, "globalState">, private h: LayoutHooks) {}

  get layout(): LayoutId { return this.current_; }

  /** Moves to `layout`. Calls queue up, so a double click cannot interleave two settings rewrites. */
  enter(layout: LayoutId): Promise<void> {
    const run = this.queue.then(() => (layout === "agent" ? this.toAgent() : this.toEditor()));
    this.queue = run.catch((e) => this.h.log(`layout: ${String(e).slice(0, 200)}`));
    return run;
  }
  toggle(): Promise<void> { return this.enter(this.current_ === "agent" ? "editor" : "agent"); }

  /** Activation: if a window that died in Agent mode left the settings hidden, put them back. A live owner keeps them. */
  async recover(): Promise<void> {
    const b = this.ctx.globalState.get<Backup>(BACKUP_KEY);
    const stale = b !== undefined && Date.now() - b.at > MAX_BACKUP_AGE_MS;     // a recycled pid must not keep the chrome hidden for good
    if (!b || (!stale && b.pid !== process.pid && alive(b.pid))) return;
    this.h.log(`layout: restoring settings left hidden by a window that ended in Agent mode (pid ${b.pid})`);
    await this.restore(b);
  }

  /** Deactivate: leave Agent mode so the user is never left with hidden chrome. */
  async leave(): Promise<void> {
    await this.queue;
    if (this.current_ === "agent") await this.toEditor();
  }

  private async toAgent(): Promise<void> {
    this.h.openAgentWindow();
    if (this.current_ === "agent") return;
    if (this.h.hideChrome()) {
      let b = this.ctx.globalState.get<Backup>(BACKUP_KEY);
      if (!b || !alive(b.pid) || b.pid === process.pid) {                    // never overwrite another live window's backup
        const values: Record<string, Saved> = {};
        const wb = vscode.workspace;
        for (const [key] of HIDE) {
          const sec = key.slice(0, key.lastIndexOf(".")), name = key.slice(key.lastIndexOf(".") + 1);
          const inspected = wb.getConfiguration(sec).inspect(name);
          values[key] = { had: inspected?.globalValue !== undefined, value: inspected?.globalValue };
        }
        b = { pid: process.pid, at: Date.now(), values };
        await this.ctx.globalState.update(BACKUP_KEY, b);                  // saved BEFORE anything changes
      }
      for (const [key, hidden] of HIDE) await this.set(key, hidden);
      for (const cmd of ["workbench.action.closeSidebar", "workbench.action.closeAuxiliaryBar", "workbench.action.closePanel"]) {
        await vscode.commands.executeCommand(cmd);                         // all three only close; none toggles
      }
    }
    this.current_ = "agent";
    await vscode.commands.executeCommand("setContext", "co4fe3.agentMode", true);
    this.h.onChange("agent");
  }

  private async toEditor(): Promise<void> {
    this.h.closeAgentWindow();
    const b = this.ctx.globalState.get<Backup>(BACKUP_KEY);
    const wasHidden = this.current_ === "agent" && b?.pid === process.pid;
    if (b && b.pid === process.pid) await this.restore(b);
    const changed = this.current_ !== "editor";
    this.current_ = "editor";
    await vscode.commands.executeCommand("setContext", "co4fe3.agentMode", false);
    if (changed) {
      if (wasHidden) await vscode.commands.executeCommand("workbench.view.explorer");   // the sidebar was closed for Agent mode
      void this.h.showDock();
      this.h.onChange("editor");
    }
  }

  private async restore(b: Backup): Promise<void> {
    for (const [key, saved] of Object.entries(b.values)) await this.set(key, saved.had ? saved.value : undefined);
    await this.ctx.globalState.update(BACKUP_KEY, undefined);
  }

  private async set(key: string, value: unknown): Promise<void> {
    const sec = key.slice(0, key.lastIndexOf(".")), name = key.slice(key.lastIndexOf(".") + 1);
    try { await vscode.workspace.getConfiguration(sec).update(name, value, vscode.ConfigurationTarget.Global); }
    catch (e) { this.h.log(`layout: could not set ${key}: ${String(e).slice(0, 120)}`); }
  }
}
