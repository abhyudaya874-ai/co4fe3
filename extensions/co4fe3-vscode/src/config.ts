import * as vscode from "vscode";
import type { Mode } from "@co4fe3/agent-core";

export interface Config {
  trueforge: { url: string; command: string };
  models: { order: string[] };
  mode: Mode;
  crew: { enabled: boolean };
  context: { packTokens: number };
  latency: { autoOrderInline: boolean; hedgeInline: boolean };
  commands: { timeoutSeconds: number };
  autoApprove: { terminal: boolean };
}

/** Re-read on every use, so settings changes apply without a reload (P8). */
export function readConfig(): Config {
  const c = vscode.workspace.getConfiguration("co4fe3");
  return {
    trueforge: { url: c.get<string>("trueforge.url", "http://localhost:8790"), command: c.get<string>("trueforge.command", "npm run trueforge") },
    models: { order: c.get<string[]>("models.order", []) },
    mode: c.get<Mode>("mode", "agent"),
    crew: { enabled: c.get<boolean>("crew.enabled", true) },
    context: { packTokens: c.get<number>("context.packTokens", 6000) },
    latency: { autoOrderInline: c.get<boolean>("latency.autoOrderInline", true), hedgeInline: c.get<boolean>("latency.hedgeInline", true) },
    commands: { timeoutSeconds: c.get<number>("commands.timeoutSeconds", 120) },
    autoApprove: { terminal: c.get<boolean>("autoApprove.terminal", false) },
  };
}
