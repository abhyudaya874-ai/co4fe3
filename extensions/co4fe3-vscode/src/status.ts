import * as vscode from "vscode";

/** The status bar: TrueForge state, model, mode, last TTFT, and a transient Undo. */
export class StatusItems {
  private readonly tf: vscode.StatusBarItem;
  private readonly model: vscode.StatusBarItem;
  private readonly mode: vscode.StatusBarItem;
  private readonly ttft: vscode.StatusBarItem;
  private readonly undo: vscode.StatusBarItem;
  private undoTimer: NodeJS.Timeout | undefined;

  constructor() {
    this.tf = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.model = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this.mode = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
    this.ttft = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 97);
    this.undo = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 96);
    this.tf.command = "co4fe3.startTrueForge";
    this.model.command = "co4fe3.pickModel";
    this.mode.command = "co4fe3.cycleMode";
    this.undo.command = "co4fe3.undoLast";
    this.setTrueforge("starting", "");
    this.model.text = "$(sparkle) …";
    this.mode.text = "$(comment) agent";
    for (const it of [this.tf, this.model, this.mode, this.ttft, this.undo]) it.show();
  }

  setTrueforge(state: "connected" | "waiting" | "down" | "starting", detail: string): void {
    this.tf.text = state === "connected" ? `$(check) TF` : state === "waiting" ? "$(sync) TF…" : state === "down" ? "$(error) TF ✗" : "$(sync) TF";
    this.tf.tooltip = detail || `TrueForge ${state}`;
  }

  setTools(count: number): void {
    this.tf.text = `$(check) TF ✓ ${count} tools`;
    this.tf.tooltip = "TrueForge connected; co4fe3 editor tools registered";
  }

  setModel(name: string): void { this.model.text = `$(sparkle) ${name.split("/").at(-1) ?? name}`; this.model.tooltip = name; }
  setMode(mode: string): void { this.mode.text = `$(comment) ${mode}`; }
  setTtft(ms: number, model: string): void { this.ttft.text = `⚡ ${(ms / 1000).toFixed(1)} s`; this.ttft.tooltip = `time to first token · ${model}`; }
  inline(phase: string): void { this.ttft.text = `$(loading) ${phase}`; }   // the inline-edit phase while it runs

  /** Shows "↶ Undo" for 30 s after an apply (rule 30). */
  showUndo(): void {
    this.undo.text = `$(discard) Undo`;
    this.undo.show();
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoTimer = setTimeout(() => this.undo.hide(), 30_000);
  }

  dispose(): void {
    if (this.undoTimer) clearTimeout(this.undoTimer);
    for (const it of [this.tf, this.model, this.mode, this.ttft, this.undo]) it.dispose();
  }
}
