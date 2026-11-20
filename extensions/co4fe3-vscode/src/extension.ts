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
import { loadInstructions, commandPolicy, deny, allow, safeJson, RunCommand, indexFile, rankFiles, type PendingCall, type TrueForgeApi } from "@co4fe3/agent-core";
import type { UiCommand, PanelEvent } from "@co4fe3/agent-core/panel";
import { IndexStore, ContextPacks, indexWorkspaceInBackground } from "./context/indexer.js";
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
  const persist = (rel?: string): void => {
    saveCheckpoints(ctx.storageUri, JSON.stringify(checkpoints.toJSON()));
    status.showUndo();
    if (rel) {
      changedPaths.unshift(rel);
      changedPaths.splice(20);
      void reindexFile(rel);                                                                     // rule 40: re-index on every applied change
    }
  };                                                                                             // 03: persist the log, refresh status.undo
  const applier = createApplier(host.root, checkpoints, persist);                                 // 03 the only writer
  const review = createReviewController(ctx, { store: new ReviewStore(), root: host.root });      // 03 diff editor + CodeLens + decisions
  const board = new Board();
  const policy = new TurnPolicy("idle");
  const index = new IndexStore();                                                                // 06 context/indexer.ts
  void indexWorkspaceInBackground(host, index, out);                                             // 06 chunked, never awaited
  const reindexFile = async (rel: string): Promise<void> => {
    const text = await host.readText(rel);
    if (text !== null) index.update(indexFile(rel, text));                                       // rebuilds maps over the entries (cheap)
  };
  const changedPaths: string[] = [];                                                             // this session's applied edits, newest first
  const packs = new ContextPacks(host, index, () => cfg().context.packTokens, out);              // 06 rule 40's retrieval budget
  const idleTurn = { id: "idle", signal: new AbortController().signal, policy };
  const turnRef: { idle: typeof idleTurn; current: typeof idleTurn } = { idle: idleTurn, current: idleTurn };   // 06: tools see the live turn
  let lastInstructions: Awaited<ReturnType<typeof loadInstructions>> | null = null;
  const mcp = await startMcpHttp(() => createEditorMcpServer({
    host, applier, review: review.store, board,
    index: () => index.get(),
    instructions: async () => { lastInstructions = await loadInstructions(host); return lastInstructions; },
    turn: () => turnRef.current,
    changes: (turnId) => applier.ofTurn(turnId),
    log: (l) => out.info(l),
  }), (l) => out.info(l));                                                                       // 02 binds 127.0.0.1:0 only
  ctx.subscriptions.push({ dispose: () => void mcp.close() });
  const serverName = mcpServerNameFor(host.root);                                                // 02 "co4fe3-ws-<8 hex>"
  void registerEditorServer(getClient, serverName, mcp, status, out);                          // 02 retries forever; never awaited
  ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {                      // a URL change re-registers (P8)
    if (e.affectsConfiguration("co4fe3.trueforge.url")) void registerEditorServer(getClient, serverName, mcp, status, out);
  }));
  ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => {                        // 06 re-index on save
    const rel = vscode.workspace.asRelativePath(doc.uri, false);
    if (!rel.startsWith("..")) void reindexFile(rel);
  }));
  ctx.subscriptions.push(vscode.workspace.onDidDeleteFiles((e) => {
    for (const u of e.files) index.remove(vscode.workspace.asRelativePath(u, false));
  }));
  registerReviewCommands(ctx, { review, applier, checkpoints, index, out });                             // 03 commands

  const specFor = (mode: "inline" | "agent" | "ask" | "plan", model: string): AgentSpec => buildSpec(   // 04 the inline-spec factory
    (mode === "inline" ? inlineAgent : coderAgent) as unknown as AgentSpec,
    { model, editorServer: serverName, mode: mode === "inline" ? "agent" : mode, crew: cfg().crew.enabled });   // the mode decides the tools; inline has none via its own file
  const sessions = new SessionPool(getClient, specFor);                                             // 04 pre-warmed sessions
  let discoveredOrder: string[] = [];                                                             // models.order unset → first two TF lists
  const modelOrder = (): string[] => cfg().models.order.length ? cfg().models.order : discoveredOrder;
  void getClient().models.list().then(({ data }) => { discoveredOrder = data.slice(0, 2).map((m) => m.name); refreshModel(); }).catch(() => undefined);
  const router = new Router(ctx, getClient, {                                                       // 08 fallback + stats + benched order
    order: modelOrder,
    autoOrderInline: () => cfg().latency.autoOrderInline,
    hedgeInline: () => cfg().latency.hedgeInline,
    take: (mode, model) => sessions.take(mode, model),
    warm: (mode, model) => sessions.warm(mode, model),
    specFor,
    log: (l) => { out.info(l); refreshModel(); },                                    // stats change on every note
  });
  const refreshModel = (): void => {
    const order = router.order("inline");
    const primary = modelOrder()[0];
    const b = primary ? router.benched(primary) : undefined;
    status.setModel(order[0] ?? "(no model)", b ? { until: b.benchedUntil, why: b.lastError ?? "failed" } : undefined);
  };
  refreshModel();
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
    host, review, crew, board, sessions, router, bridge: { push: bridgePush, flush: () => panel.bridge?.flush() } as Bridge,
    cfg, serverName,
    instructions: async () => { lastInstructions = await loadInstructions(host); return lastInstructions; },
    packFor: (text, active, recent) => packs.packFor(text, active, recent),                  // 06
    status: { setTtft: (ms, m) => status.setTtft(ms, m) },
    turn: turnRef,
    recent: () => changedPaths,
    approveCommand, out,
  }, makeOnPause);
  panel.onCommand = (m: UiCommand) => {                                                            // 05 the UiCommand switch
    switch (m.type) {
      case "ready": panel.bridge?.flush(); break;
      case "send": void turns.send(m.text); break;
      case "focus": { const m0 = router.order("agent")[0]; if (m0) sessions.warm("agent", m0); break; }   // lever 3
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
      case "complete": {
        const pfx = m.prefix.toLowerCase();
        const items: string[] = [];
        if (m.kind === "@") {
          const ix = index.get();                                    // files first, then symbols, ≤ 20 (rule 40)
          if (ix) {
            const files = [...ix.byPath.keys()].filter((p) => p.toLowerCase().includes(pfx)).sort((a, b) => a.length - b.length || a.localeCompare(b));
            const syms = [...ix.defs.keys()].filter((n) => n.toLowerCase().includes(pfx)).sort();
            items.push(...files, ...syms.map((n) => `symbol:${n}`));
          }
        } else {
          for (const i of lastInstructions?.items ?? []) {
            if (i.kind === "workflow" && i.name.toLowerCase().startsWith(pfx)) items.push(i.name);
          }
        }
        panel.completions(m.kind, items.slice(0, 20));
        break;
      }
    }
  };
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(PanelView.id, panel, { webviewOptions: { retainContextWhenHidden: true } }));
  ctx.subscriptions.push(
    vscode.commands.registerCommand("co4fe3.pickModel", () => pickModel()),
    vscode.commands.registerCommand("co4fe3.resetStats", () => { router.resetStats(); refreshModel(); void vscode.window.showInformationMessage("co4fe3: model stats cleared."); }),
  );
  /** The model picker: TrueForge's list, stats in the description, two picks → models.order (rule 70 §5). */
  async function pickModel(): Promise<void> {
    const { data: models } = await getClient().models.list().catch(() => ({ data: [] as { name: string }[] }));
    if (!models.length) return void vscode.window.showWarningMessage("No models from TrueForge — is it running?");
    const items = models.map((m) => {
      const s = router.stat(m.name);
      const sorted = s ? [...s.ttft].sort((a, b) => a - b) : [];
      const p50 = sorted.length >= 3 ? `p50 ${(sorted[Math.floor(sorted.length / 2)]! / 1000).toFixed(1)} s` : "no samples";
      const benched = s && s.benchedUntil > Date.now() ? ` · benched ${Math.ceil((s.benchedUntil - Date.now()) / 60000)} min` : "";
      return { label: m.name, description: `${p50} · ${s?.ok ?? 0} ok${s?.fail ? ` · ${s.fail} failed` : ""}${benched}` };
    });
    const first = await vscode.window.showQuickPick(items, { title: "co4fe3: primary model", placeHolder: "Used first for every request" });
    if (!first) return;
    const second = await vscode.window.showQuickPick(items.filter((i) => i.label !== first.label), { title: "co4fe3: fallback model", placeHolder: "Tried when the primary fails (Esc keeps none)" });
    await vscode.workspace.getConfiguration("co4fe3").update("models.order", second ? [first.label, second.label] : [first.label], vscode.ConfigurationTarget.Workspace);
    refreshModel();
  }
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
    index: () => index.get(),
    cfg,
  });
}

export function deactivate(): void {}

interface ReviewDeps {
  review: ReturnType<typeof createReviewController>;
  applier: ReturnType<typeof createApplier>;
  checkpoints: CheckpointLog;
  index: IndexStore;
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
    ctx.subscriptions.push(vscode.commands.registerCommand("co4fe3.dev.rank", async () => {
      const text = await vscode.window.showInputBox({ prompt: "Prompt to rank files for" });
      if (!text) return;
      const ix = d.index.get();
      if (!ix) return void vscode.window.showInformationMessage("The index is still building.");
      const ranked = rankFiles(ix, { text, mentioned: [], recent: [] }).slice(0, 10);
      d.out.info(`dev.rank "${text.slice(0, 80)}"\n${ranked.map((r, i) => `${i + 1}. ${r.path}\n   ${r.why.join(" · ")}`).join("\n")}`);
      void vscode.window.showInformationMessage(`dev.rank: ${ranked.slice(0, 3).map((r) => r.path).join(", ")} — full list in the output channel`);
    }));
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
