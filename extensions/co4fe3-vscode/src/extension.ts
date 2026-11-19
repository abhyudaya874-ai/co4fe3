import * as vscode from "vscode";

// Wiring only (rule 10). Each workflow adds its lines to activate(); nothing slow is awaited here (< 150 ms).
export function activate(ctx: vscode.ExtensionContext): void {
  const out = vscode.window.createOutputChannel("co4fe3", { log: true });
  ctx.subscriptions.push(out);
  out.info("co4fe3 activated");
}

export function deactivate(): void {}
