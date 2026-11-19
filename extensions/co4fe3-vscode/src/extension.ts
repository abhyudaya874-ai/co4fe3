import * as vscode from "vscode";
import { makeClient, startMcpHttp, createEditorMcpServer, ReviewStore, Board, TurnPolicy, type Applier, type ApplyResult, type FileChange } from "@co4fe3/agent-core";
import { readConfig } from "./config.js";
import { StatusItems } from "./status.js";
import { createEditorHost } from "./host/editorHost.js";
import { mcpServerNameFor, registerEditorServer } from "./forge/sessions.js";

// Wiring only (rule 10). Each workflow adds its lines to activate(); nothing slow is awaited here (< 150 ms).
export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const out = vscode.window.createOutputChannel("co4fe3", { log: true });                      // 00
  ctx.subscriptions.push(out);
  out.info("co4fe3 activated");
  const cfg = (): ReturnType<typeof readConfig> => readConfig();                                 // 02 config.ts (re-read: settings change)
  const status = new StatusItems();                                                              // 02 status.ts
  ctx.subscriptions.push(status);
  const host = createEditorHost(ctx, out);                                                       // 02 host/editorHost.ts
  const client = makeClient(cfg().trueforge.url);                                                // 02 agent-core forge/client.ts

  // Workflow 03 replaces the stub applier with createApplier (the single writer). Until then nothing can be written.
  const stubApplier: Applier = {
    apply: async (_c: FileChange): Promise<ApplyResult> => ({ ok: false, why: "io", detail: "The review core lands in the next build; edits are not writable yet." }),
    undo: async () => ({ ok: false, why: "io", detail: "The review core lands in the next build." }),
  };
  const review = new ReviewStore();
  const board = new Board();
  const policy = new TurnPolicy("idle");
  const mcp = await startMcpHttp(() => createEditorMcpServer({
    host, applier: stubApplier, review, board,
    index: () => null,
    instructions: async () => ({ items: [], sources: [] }),
    turn: () => ({ id: "idle", signal: new AbortController().signal, policy }),
    changes: () => [],
    log: (l) => out.info(l),
  }), (l) => out.info(l));                                                                       // 02 binds 127.0.0.1:0 only
  ctx.subscriptions.push({ dispose: () => void mcp.close() });
  const serverName = mcpServerNameFor(host.root);                                                // 02 "co4fe3-ws-<8 hex>"
  void registerEditorServer(client, serverName, mcp, status, out);                               // 02 retries with backoff; never awaited
}

export function deactivate(): void {}
