import * as vscode from "vscode";
import type { Mode } from "@co4fe3/agent-core";

export interface Config {
  trueforge: { url: string; command: string };
  /** `explicit`: the user wrote `models.order` in a settings file. Unset, the default pair is used and padded with other served models. */
  models: { order: string[]; explicit: boolean };
  mode: Mode;
  crew: { enabled: boolean };
  context: { packTokens: number };
  latency: { autoOrderInline: boolean; hedgeInline: boolean };
  commands: { timeoutSeconds: number };
  autoApprove: { terminal: boolean };
  agentMode: { hideChrome: boolean };
  editor: { openDiffs: boolean };
}

const DEFAULT_TF_COMMAND = "OUTBOUND_URL_ALLOWED_HOSTS='[\"127.0.0.1\",\"localhost\"]' npx --yes @truefoundry/trueforge@0.185.1";

/** Re-read on every use, so settings changes apply without a reload (P8). */
export function readConfig(): Config {
  const c = vscode.workspace.getConfiguration("co4fe3");
  const order = c.inspect<string[]>("models.order");
  const explicit = [order?.globalValue, order?.workspaceValue, order?.workspaceFolderValue].some((v) => v !== undefined);
  return {
    trueforge: { url: c.get<string>("trueforge.url", "http://localhost:8790"), command: c.get<string>("trueforge.command", DEFAULT_TF_COMMAND) },
    models: { order: c.get<string[]>("models.order", []), explicit },
    mode: c.get<Mode>("mode", "agent"),
    crew: { enabled: c.get<boolean>("crew.enabled", true) },
    context: { packTokens: c.get<number>("context.packTokens", 6000) },
    latency: { autoOrderInline: c.get<boolean>("latency.autoOrderInline", true), hedgeInline: c.get<boolean>("latency.hedgeInline", true) },
    commands: { timeoutSeconds: c.get<number>("commands.timeoutSeconds", 120) },
    autoApprove: { terminal: c.get<boolean>("autoApprove.terminal", false) },
    agentMode: { hideChrome: c.get<boolean>("agentMode.hideChrome", true) },
    editor: { openDiffs: c.get<boolean>("editor.openDiffs", true) },
  };
}
