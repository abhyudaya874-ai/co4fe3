import * as vscode from "vscode";
import { makeClient, startMcpHttp, createEditorMcpServer, ReviewStore, Board, TurnPolicy, CheckpointLog, toHunks, planEdit, previewLines, applyHunks, buildSpec, newErrors, renderProblem, type Applier, type FileChange, type Proposal, type AgentSpec } from "@co4fe3/agent-core";
import { readConfig } from "./config.js";
import { StatusItems } from "./status.js";
import { createEditorHost, currentText } from "./host/editorHost.js";
import { mcpServerNameFor, registerEditorServer, SessionPool } from "./forge/sessions.js";
import { Router } from "./forge/router.js";
import { createApplier, applyDecision, saveCheckpoints } from "./review/apply.js";
import { createReviewController } from "./review/controller.js";
import { registerInlineEdit } from "./inline/inlineEdit.js";
import { PanelView } from "./panel/panelView.js";
import { AgentTurns } from "./panel/agentTurn.js";
import { Crew } from "./panel/crew.js";
import type { Bridge } from "./panel/bridge.js";
import { makeOnPause, jailedPathArg, type PauseDeps } from "./panel/pause.js";
import { loadInstructions, commandPolicy, deny, allow, safeJson, RunCommand, type PendingCall, type TrueForgeApi } from "@co4fe3/agent-core";
import type { UiCommand, PanelEvent } from "@co4fe3/agent-core/panel";
import inlineAgent from "../../../agents/co4fe3-inline.agent.json";
import coderAgent from "../../../agents/co4fe3-coder.agent.json";

// Wiring only (rule 10). Each workflow adds its lines to activate(); nothing slow is awaited here (< 150 ms).
export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const out = vscode.window.createOutputChannel("co4fe3", { log: true });                      // 00
  ctx.subscriptions.push(out);
  out.info("co4fe3 activated");
  const cfg = (): ReturnType<typeof readConfig> => readConfig();                                 // 02 config.ts (re-read: settings change)
  const status = new StatusItems();                                                              // 02 status.ts
  ctx.subscriptions.push(status);
  const host = createEditorHost(ctx, out);                                                       // 02 host/editorHost.ts
  // The client re-reads the URL from settings, so a change applies without a reload (P8).
  let clientUrl = cfg().trueforge.url;
  let client = makeClient(clientUrl);                                                            // 02 agent-core forge/client.ts
  const getClient = (): typeof client => {
    const u = cfg().trueforge.url;
    if (u !== clientUrl) { clientUrl = u; client = makeClient(u); }
    return client;
  };
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
  void registerEditorServer(getClient, serverName, mcp, status, out);                          // 02 retries forever; never awaited
  ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {                      // a URL change re-registers (P8)
    if (e.affectsConfiguration("co4fe3.trueforge.url")) void registerEditorServer(getClient, serverName, mcp, status, out);
  }));
  registerReviewCommands(ctx, { review, applier, checkpoints, out });                             // 03 commands

  const sessions = new SessionPool(getClient, (mode, model) => buildSpec(                            // 04 pre-warmed sessions
    (mode === "inline" ? inlineAgent : coderAgent) as unknown as AgentSpec,
    { model, editorServer: serverName, mode: "agent", crew: cfg().crew.enabled }));
  const router = new Router(getClient, {                                                            // 04 one model; 08 adds fallback and stats
    order: () => cfg().models.order,
    take: (mode, model) => sessions.take(mode, model),
    log: (l) => out.info(l),
  });
  const panel = new PanelView(ctx);                                                              // 05 the webview
  const crew = new Crew(cfg().mode, (e) => panel.bridge?.push(e));
  const approveCommand = async (p: PendingCall, signal: AbortSignal): Promise<TrueForgeApi.TurnUserEventMessage> => {
    const v = RunCommand.safeParse(safeJson(p.call?.function?.arguments));
    const command = v.success ? v.data.command : String(p.call?.function?.arguments ?? "").slice(0, 200);
    const policy = commandPolicy(command);
    if (!policy.ok) return deny(p, `Refused by the command policy: ${policy.why}.`);
    if (cfg().autoApprove.terminal) return allow(p);
    const id = `cmd-${p.toolCallId}`;
    panel.bridge?.push({ kind: "command", id, command, state: "asking" });
    const verdict = await new Promise<"allow" | "deny">((resolve) => {
      pendingCommands.set(id, resolve);
      signal.addEventListener("abort", () => resolve("deny"), { once: true });
    });
    panel.bridge?.push({ kind: "command", id, command, state: verdict === "allow" ? "running" : "denied" });
    return verdict === "allow" ? allow(p) : deny(p, "The user denied this command.");
  };
  const pendingCommands = new Map<string, (v: "allow" | "deny") => void>();
  let lastSessionUrl: string | undefined;
  const bridgePush = (e: PanelEvent): void => { if (e.kind === "status" && e.sessionUrl) lastSessionUrl = e.sessionUrl; panel.bridge?.push(e); };
  const turns = new AgentTurns({
    host, review, crew, sessions, router, bridge: { push: bridgePush, flush: () => panel.bridge?.flush() } as Bridge,
    cfg, serverName,
    instructions: () => loadInstructions(host),
    packFor: async () => ({ items: [], used: 0, budget: cfg().context.packTokens, skipped: [], path: "none" }),   // workflow 06 wires the IndexStore
    approveCommand, out,
  }, makeOnPause);
  panel.onCommand = (m: UiCommand) => {                                                            // 05 the UiCommand switch
    switch (m.type) {
      case "ready": panel.bridge?.flush(); break;
      case "send": void turns.send(m.text); break;
      case "stop": turns.stop(); break;
      case "decide": {
        const p = review.store.get(m.key);
        if (p) { review.store.decide(m.key, m.hunkId, m.verdict); review.refresh(p.path, m.key); }
        break;
      }
      case "decideAll": {
        const p = review.store.get(m.key);
        if (p) { review.store.decideAll(m.key, m.verdict); review.refresh(p.path, m.key); }
        break;
      }
      case "openDiff": {
        const p = review.store.get(m.key);
        if (p) void vscode.commands.executeCommand("vscode.diff", p.before === null ? vscode.Uri.from({ scheme: "co4fe3-proposal", path: `/${p.path}`, query: `key=${p.key}&side=empty` }) : vscode.Uri.file(`${host.root}/${p.path}`), vscode.Uri.from({ scheme: "co4fe3-proposal", path: `/${p.path}`, query: `key=${p.key}&side=right` }), `${p.path} ↔ proposed by ${p.by}`);
        break;
      }
      case "command": {
        const resolve = pendingCommands.get(m.id);
        if (resolve) { pendingCommands.delete(m.id); resolve(m.verdict); }
        break;
      }
      case "undo": void applier.undo(m.checkpointId); break;
      case "revertTurn": for (const cp of applier.ofTurn(m.turnId)) void applier.undo(cp.id); break;
      case "openSession": {
        const url = lastSessionUrl;
        if (url) void vscode.env.openExternal(vscode.Uri.parse(url));
        break;
      }
      case "pickModel": void vscode.commands.executeCommand("co4fe3.pickModel"); break;
      case "setMode": void vscode.workspace.getConfiguration("co4fe3").update("mode", m.mode); break;
      case "complete": break;   // @ and / autocomplete arrive with workflow 06
    }
  };
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(PanelView.id, panel, { webviewOptions: { retainContextWhenHidden: true } }));
  registerInlineEdit(ctx, {                                                                      // 04 Task A
    host, review, sessions, router, out,
    status: { inline: (p) => status.inline(p), setTtft: (ms, m) => status.setTtft(ms, m) },
    applyDecision: (p, d) => applyDecision(applier, p, d),
    toastApplied: (p, dec, fresh) => {
      const verdict = fresh.length ? `${fresh.length} new error${fresh.length === 1 ? "" : "s"}: ${fresh.slice(0, 3).map(renderProblem).join(" · ")}` : "No new errors.";
      void vscode.window.showInformationMessage(`Applied ${dec.accepted.length} of ${p.hunks.length} hunks to ${p.path} · ${verdict}`, "Undo").then((pick) => {
        if (pick === "Undo") void vscode.commands.executeCommand("co4fe3.undoLast");
      });
    },
    index: () => null,   // workflow 06 wires the IndexStore
  });
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
