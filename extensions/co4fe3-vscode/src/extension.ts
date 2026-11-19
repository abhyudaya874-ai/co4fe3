import * as vscode from "vscode";
import { makeClient, startMcpHttp, createEditorMcpServer, ReviewStore, Board, TurnPolicy, CheckpointLog, toHunks, planEdit, previewLines, applyHunks, type Applier, type FileChange, type Proposal } from "@co4fe3/agent-core";
import { readConfig } from "./config.js";
import { StatusItems } from "./status.js";
import { createEditorHost, currentText } from "./host/editorHost.js";
import { mcpServerNameFor, registerEditorServer } from "./forge/sessions.js";
import { createApplier, applyDecision, saveCheckpoints } from "./review/apply.js";
import { createReviewController } from "./review/controller.js";

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
  const checkpoints = new CheckpointLog();                                                       // 03 agent-core review/checkpoints.ts
  const persist = (): void => {
    saveCheckpoints(ctx.storageUri, JSON.stringify(checkpoints.toJSON()));
    status.showUndo();
  };                                                                                             // 03: persist the log, refresh status.undo
  const applier = createApplier(host.root, checkpoints, persist);                                 // 03 the only writer
  const review = createReviewController(ctx, { store: new ReviewStore(), root: host.root });      // 03 diff editor + CodeLens + decisions
  const board = new Board();
  const policy = new TurnPolicy("idle");
  const mcp = await startMcpHttp(() => createEditorMcpServer({
    host, applier, review: review.store, board,
    index: () => null,
    instructions: async () => ({ items: [], sources: [] }),
    turn: () => ({ id: "idle", signal: new AbortController().signal, policy }),
    changes: (turnId) => applier.ofTurn(turnId),
    log: (l) => out.info(l),
  }), (l) => out.info(l));                                                                       // 02 binds 127.0.0.1:0 only
  ctx.subscriptions.push({ dispose: () => void mcp.close() });
  const serverName = mcpServerNameFor(host.root);                                                // 02 "co4fe3-ws-<8 hex>"
  void registerEditorServer(client, serverName, mcp, status, out);                               // 02 retries with backoff; never awaited
  registerReviewCommands(ctx, { review, applier, checkpoints, out });                             // 03 commands
}

export function deactivate(): void {}

interface ReviewDeps {
  review: ReturnType<typeof createReviewController>;
  applier: ReturnType<typeof createApplier>;
  checkpoints: CheckpointLog;
  out: vscode.LogOutputChannel;
}

function registerReviewCommands(ctx: vscode.ExtensionContext, d: ReviewDeps): void {
  const decide = (key: string, hunkId: string, v: "accepted" | "rejected") => {
    const p = d.review.store.get(key);
    if (!p) return;
    d.review.store.decide(key, hunkId, v);
    d.review.refresh(p.path, key);
  };
  ctx.subscriptions.push(
    vscode.commands.registerCommand("co4fe3.hunk.accept", (key, hunkId) => decide(key, hunkId, "accepted")),
    vscode.commands.registerCommand("co4fe3.hunk.reject", (key, hunkId) => decide(key, hunkId, "rejected")),
    vscode.commands.registerCommand("co4fe3.hunk.acceptAtCursor", () => decideAtCursor(d, "accepted", decide)),
    vscode.commands.registerCommand("co4fe3.hunk.rejectAtCursor", () => decideAtCursor(d, "rejected", decide)),
    vscode.commands.registerCommand("co4fe3.proposal.acceptAll", () => decideAllAtCursor(d, "accepted")),
    vscode.commands.registerCommand("co4fe3.proposal.rejectAll", () => decideAllAtCursor(d, "rejected")),
    vscode.commands.registerCommand("co4fe3.undoLast", async () => {
      const last = d.applier.last();
      if (!last) return void vscode.window.showInformationMessage("Nothing to undo yet.");
      const r = await d.applier.undo(last.id);
      if (r.ok) void vscode.window.showInformationMessage(`Restored ${last.path}`);
      else void vscode.window.showWarningMessage(r.detail);
    }),
    vscode.commands.registerCommand("co4fe3.revertTurn", async (turnId: string | undefined) => {
      if (!turnId) return;
      for (const cp of d.applier.ofTurn(turnId)) await d.applier.undo(cp.id);
    }),
  );
  if (ctx.extensionMode === vscode.ExtensionMode.Development) {
    void vscode.commands.executeCommand("setContext", "co4fe3.devMode", true);
    ctx.subscriptions.push(vscode.commands.registerCommand("co4fe3.dev.sampleProposal", () => void sampleProposal(d)));
  }
}

function decideAtCursor(d: ReviewDeps, v: "accepted" | "rejected", decide: (key: string, hunkId: string, v: "accepted" | "rejected") => void): void {
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.document.uri.scheme !== "co4fe3-proposal") return;
  const key = new URLSearchParams(ed.document.uri.query).get("key") ?? "";
  const p = d.review.store.get(key);
  if (!p) return;
  const line = ed.selection.active.line;
  const shown = new Set(p.hunks.filter((h) => p.verdict[h.id] !== "rejected").map((h) => h.id));
  const at = previewLines(p.hunks, shown);
  const hit = p.hunks.filter((h) => p.verdict[h.id] === "pending").find((h) => {
    const start = at.get(h.id) ?? 0;
    const len = (shown.has(h.id) ? h.newLines.length : h.oldLines.length) || 1;
    return line >= start && line < start + len;
  });
  if (hit) decide(key, hit.id, v);
}
function decideAllAtCursor(d: ReviewDeps, v: "accepted" | "rejected"): void {
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.document.uri.scheme !== "co4fe3-proposal") return;
  const key = new URLSearchParams(ed.document.uri.query).get("key") ?? "";
  if (d.review.store.get(key)) {
    d.review.store.decideAll(key, v);
    const p = d.review.store.get(key);
    if (p) d.review.refresh(p.path, key);
  }
}

/** Builds a proposal for the active file (uppercase line 2, delete line 5, append a line) and runs the review loop. */
async function sampleProposal(d: ReviewDeps): Promise<void> {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return void vscode.window.showInformationMessage("Open a file first.");
  const rel = vscode.workspace.asRelativePath(ed.document.uri);
  const before = await currentText(ed.document.uri);
  if (before === null) return;
  const lines = before.split("\n");
  if (lines.length > 1) lines[1] = lines[1]!.toUpperCase();
  if (lines.length > 4) lines.splice(4, 1);
  lines.push("// appended by sampleProposal");
  const after = lines.join("\n");
  const plan = planEdit(before, [{ oldString: before, newString: after }]);
  if (!plan.ok) return void vscode.window.showWarningMessage(plan.error);
  const hunks = toHunks(before, plan.after);
  const key = `dev-${Date.now()}`;
  const proposal: Proposal = {
    key, turnId: "dev", threadId: "main", toolCallId: "dev", by: "dev",
    path: rel, why: "sample proposal (dev command)", before, after: plan.after,
    hunks,
    verdict: Object.fromEntries(hunks.map((h) => [h.id, "pending" as const])),
    baseline: [],
  };
  const ac = new AbortController();
  try {
    const decision = await d.review.review(proposal, ac.signal, { focus: true });
    if (decision.accepted.length === 0) return void vscode.window.showInformationMessage("Sample proposal: nothing accepted, nothing written.");
    const r = await applyDecision(d.applier, proposal, decision);
    if (r.ok) {
      void vscode.window.showInformationMessage(`Applied ${decision.accepted.length} of ${hunks.length} hunks to ${rel}`, "Undo").then((pick) => {
        if (pick === "Undo") void vscode.commands.executeCommand("co4fe3.undoLast");
      });
    } else void vscode.window.showWarningMessage(r.detail);
  } catch { /* aborted: nothing written */ }
}
