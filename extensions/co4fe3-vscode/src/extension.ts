import * as vscode from "vscode";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { makeClient, startMcpHttp, createEditorMcpServer, ReviewStore, Board, TurnPolicy, CheckpointLog, toHunks, planEdit, previewLines, buildSpec, withProjectRules, renderProblem, proposalEvent, settleProposalEvent, modelRows, sessionUrl, selectedLines, type Proposal, type AgentSpec } from "@co4fe3/agent-core";
import { readConfig } from "./config.js";
import { StatusItems } from "./status.js";
import { createEditorHost, currentText } from "./host/editorHost.js";
import { mcpServerNameFor, registerEditorServer, SessionPool } from "./forge/sessions.js";
import { Router } from "./forge/router.js";
import { ModelCatalog } from "./forge/catalog.js";
import { createApplier, applyDecision, saveCheckpoints } from "./review/apply.js";
import { createReviewController } from "./review/controller.js";
import { registerInlineEdit } from "./inline/inlineEdit.js";
import { SelectionWidget } from "./inline/selectionWidget.js";
import { DockView, AgentWindow } from "./panel/panelView.js";
import { AgentTurns } from "./panel/agentTurn.js";
import { Crew } from "./panel/crew.js";
import { FileSessionStore } from "./panel/sessionStore.js";
import { registerPlanDocs } from "./panel/planDocs.js";
import { createUiCommands, pickModelQuick } from "./panel/uiCommands.js";
import { LayoutController } from "./layout/layoutController.js";
import { makeOnPause } from "./panel/pause.js";
import { loadInstructions, commandPolicy, deny, allow, safeJson, RunCommand, indexFile, rankFiles, type PendingCall, type TrueForgeApi } from "@co4fe3/agent-core";
import { Hub, normalizeSidebar, type SidebarPrefs, UI_MODES, runtimeOf, uiModeOf, nextUiMode, type HubPort, type HostMessage, type UiMode } from "@co4fe3/agent-core/panel";
import { IndexStore, ContextPacks, indexWorkspaceInBackground } from "./context/indexer.js";
import inlineAgent from "../../../agents/co4fe3-inline.agent.json";
import coderAgent from "../../../agents/co4fe3-coder.agent.json";

let shutdown: (() => Promise<void>) | undefined;

/** `secondarySidebar` views exist from VS Code 1.106. Older hosts get the chat in the activity bar instead. */
const supportsSecondarySidebar = (version: string): boolean => {
  const [major = 0, minor = 0] = version.split(".").map((n) => Number.parseInt(n, 10));
  return major > 1 || (major === 1 && minor >= 106);
};
const newSessionId = (): string => `s${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;

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

  // The transcript's single source of truth, and where stored sessions live (the extension's own folder, not the workspace).
  const sessionsDir = path.join((ctx.storageUri ?? ctx.globalStorageUri).fsPath, "sessions");
  const sessionStore = new FileSessionStore(sessionsDir, (l) => out.info(l));
  const hub = new Hub({ store: sessionStore, now: () => Date.now(), newId: newSessionId });
  ctx.subscriptions.push({ dispose: () => hub.dispose() });

  // The composer's mode (Code / Ask / Plan / Bypass) lives here and in globalState, never in a settings file.
  const stored = ctx.globalState.get<string>("co4fe3.uiMode");
  let uiMode: UiMode = UI_MODES.some((m) => m.id === stored) ? (stored as UiMode) : uiModeOf(cfg().mode, cfg().autoApprove.terminal);
  const modeLabel = (m: UiMode): string => UI_MODES.find((x) => x.id === m)?.label ?? m;
  const setUiMode = (m: UiMode): void => {
    if (m === uiMode) return;
    uiMode = m; void ctx.globalState.update("co4fe3.uiMode", m);
    hub.setChrome({ mode: m }); status.setMode(modeLabel(m));
  };
  status.setMode(modeLabel(uiMode));
  hub.setChrome({ mode: uiMode, folder: vscode.workspace.workspaceFolders?.[0]?.name ?? "" });
  const autoApproveCommands = (): boolean => runtimeOf(uiMode).autoApproveCommands || cfg().autoApprove.terminal;

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
  let instructionsStale = true;                                                                // 10: reload when the glob matches
  const instructions = async (): Promise<NonNullable<typeof lastInstructions>> => {
    if (!lastInstructions || instructionsStale) { lastInstructions = await loadInstructions(host); instructionsStale = false; }
    return lastInstructions;
  };
  const instrWatch = vscode.workspace.createFileSystemWatcher("{AGENTS.md,CLAUDE.md,.github/*.md,.cursorrules,.v3coderules,.voidrules,.co4fe3/**,.devin/**,.v3code/**}");
  instrWatch.onDidCreate(() => { instructionsStale = true; }); instrWatch.onDidChange(() => { instructionsStale = true; }); instrWatch.onDidDelete(() => { instructionsStale = true; });
  ctx.subscriptions.push(instrWatch);
  const approvedCommands: { id: string; command: string; turn: string }[] = [];                   // approved by the user (or by Bypass), not yet started
  const mcp = await startMcpHttp(() => createEditorMcpServer({
    host, applier, review: review.store, board,
    index: () => index.get(),
    instructions,
    turn: () => turnRef.current,
    changes: (turnId) => applier.ofTurn(turnId),
    log: (l) => out.info(l),
    onCommand: (command) => {                                                                    // the card of the command that is about to run: its output fills in while it runs
      for (let n = approvedCommands.length - 1; n >= 0; n--) if (approvedCommands[n]!.turn !== turnRef.current.id) approvedCommands.splice(n, 1);   // left over from an earlier turn
      const i = approvedCommands.findIndex((c) => c.command === command);
      if (i < 0) return undefined;
      const { id } = approvedCommands.splice(i, 1)[0]!;
      return { output: (text) => hub.push({ kind: "command", id, command, state: "running", output: text }), done: () => undefined };
    },
    onApplied: (a) => {                                                                          // the diff card learns the checkpoint and the verify verdict
      const last = hub.proposal(a.key);
      if (last) hub.push(settleProposalEvent(last, { applied: { checkpointId: a.checkpointId, newErrors: a.newErrors } }));
      if (shownInEditor.has(a.key)) settleEditorDiff(a.key, a.path, true);                       // the diff closes and the real file opens at the change
      else if (wantsEditorDiff()) void review.reveal(a.path, firstChangedLine.get(a.key) ?? last?.hunks[0]?.oldStart ?? 0);
    },
    onPlan: (p) => {                                                                             // the plan card; Accept starts the Code-mode turn (uiCommands "plan")
      const t = turnRef.current;
      if (t.id === turnRef.idle.id) return "No request is running.";
      if (runtimeOf(uiMode).mode !== "plan") return "write_plan is for Plan mode only. Make the change with propose_edit.";
      hub.push({ kind: "plan", id: t.id, turnId: t.id, title: p.title, summary: p.summary, body: p.body, state: "proposed" });
      return undefined;
    },
  }), (l) => out.info(l));
  ctx.subscriptions.push(registerPlanDocs(hub));                                                                       // 02 binds 127.0.0.1:0 only
  ctx.subscriptions.push({ dispose: () => void mcp.close() });
  const serverName = mcpServerNameFor(host.root);                                                // 02 "co4fe3-ws-<8 hex>"
  const tfStatus = {                                                                             // the status bar and the chat show the same TrueForge state
    setTrueforge: (s: "connected" | "waiting" | "down" | "starting", d: string): void => { status.setTrueforge(s, d); hub.setChrome({ trueforge: s }); },
    setTools: (n: number): void => { status.setTools(n); hub.setChrome({ trueforge: "connected" }); },
  };
  void registerEditorServer(getClient, serverName, mcp, tfStatus, out);                          // 02 retries forever; never awaited
  ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {                      // a URL change re-registers (P8)
    if (e.affectsConfiguration("co4fe3.trueforge.url")) void registerEditorServer(getClient, serverName, mcp, tfStatus, out);
    if (e.affectsConfiguration("co4fe3.models")) refreshModel();
    if (e.affectsConfiguration("co4fe3.mode")) setUiMode(uiModeOf(cfg().mode, false));          // an explicit change of the setting wins over the last choice in the chat
  }));
  ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => {                        // 06 re-index on save
    const rel = vscode.workspace.asRelativePath(doc.uri, false);
    if (!rel.startsWith("..")) void reindexFile(rel);
  }));
  ctx.subscriptions.push(vscode.workspace.onDidDeleteFiles((e) => {
    for (const u of e.files) index.remove(vscode.workspace.asRelativePath(u, false));
  }));
  registerReviewCommands(ctx, { review, applier, checkpoints, index, out });                             // 03 commands

  // Diff cards in the chat follow the review store, whoever decides (a card button, CodeLens, a keybinding). In Editor mode the
  // change also opens in the editor the moment it is proposed (nothing is written before it is accepted: law 4), and the
  // diff goes away once it is decided.
  const shownInEditor = new Set<string>();
  const wantsEditorDiff = (): boolean => layout.layout === "editor" && cfg().editor.openDiffs;
  const settleEditorDiff = (key: string, rel: string | undefined, applied: boolean): void => {
    if (!shownInEditor.delete(key)) return;
    void review.close(key).then(() => { if (applied && rel && wantsEditorDiff()) return review.reveal(rel, firstChangedLine.get(key) ?? 0); });
  };
  const firstChangedLine = new Map<string, number>();
  ctx.subscriptions.push({ dispose: review.store.onChange((key) => {
    const p = review.store.get(key);
    if (p) {
      if (p.by === "inline") return;                                                             // inline edits review in the editor's own widget
      hub.push(proposalEvent(p));
      const pending = p.hunks.some((h) => p.verdict[h.id] === "pending");
      if (pending && !shownInEditor.has(key) && wantsEditorDiff()) {
        shownInEditor.add(key);
        firstChangedLine.set(key, p.hunks[0]?.oldStart ?? 0);
        void review.show(key);                                                                   // opens this proposal's diff, without taking focus
      } else if (!pending) settleEditorDiff(key, p.path, false);                                 // decided: the write follows through propose_edit; onApplied reveals the file
      return;
    }
    const last = hub.proposal(key);                                                              // gone from the store: dropped (Stop, turn end) or taken by propose_edit
    if (last && !last.applied) { const dropped = settleProposalEvent(last, { dropped: true }); if (dropped !== last) hub.push(dropped); }
    if (last) settleEditorDiff(key, last.path, false);
  }) });

  /** `project` = the rendered project rules and AGENTS.md. They come FIRST in the instructions; the lead's own protocol (the crew rules) follows. */
  const specFor = (mode: "inline" | "agent" | "ask" | "plan", model: string, project?: string): AgentSpec => {
    const file = (mode === "inline" ? inlineAgent : coderAgent) as unknown as AgentSpec;
    const base = String(file.instructions ?? "");
    return buildSpec(file, { model, editorServer: serverName, mode: mode === "inline" ? "agent" : mode, crew: cfg().crew.enabled,
      ...(mode !== "inline" && project ? { instructions: withProjectRules(base, project) } : {}) });       // the mode decides the tools; inline has none via its own file
  };
  const sessions = new SessionPool(getClient, specFor);                                             // 04 pre-warmed sessions
  const catalog = new ModelCatalog(ctx, getClient, cfg, (l) => out.info(l), () => refreshModel());   // what TrueForge serves, the user's pick, recents
  ctx.subscriptions.push({ dispose: () => catalog.dispose() });
  const router = new Router(ctx, getClient, {                                                       // 08 fallback + stats + benched order
    order: () => catalog.order(),
    autoOrderInline: () => cfg().latency.autoOrderInline && catalog.pick === null,   // a model the user picked in the chat is not re-ordered away
    hedgeInline: () => cfg().latency.hedgeInline,
    take: (mode, model) => sessions.take(mode, model),
    warm: (mode, model) => sessions.warm(mode, model),
    log: (l) => { out.info(l); refreshModel(); },                                    // stats change on every note
  });
  const modelsMessage = (): HostMessage => ({
    type: "models", rows: modelRows(catalog.served, router.statsMap(), Date.now(), catalog.recent),
    current: router.order("agent")[0] ?? "", auto: catalog.pick === null,
  });
  const refreshModel = (): void => {
    const primary = router.order("agent")[0];
    const b = primary ? router.benched(primary) : undefined;
    status.setModel(primary ?? "(no model)", b ? { until: b.benchedUntil, why: b.lastError ?? "failed" } : undefined);
    hub.setChrome({ model: primary ?? "" });                                                    // the chip tracks the current primary
    hub.broadcast(modelsMessage());
  };
  refreshModel();
  void catalog.discover();                                                                      // retries until TrueForge answers (it may start after VS Code)

  const crew = new Crew(runtimeOf(uiMode).mode, (e) => hub.push(e));
  const pendingCommands = new Map<string, (v: "allow" | "deny") => void>();
  const approveCommand = async (p: PendingCall, signal: AbortSignal): Promise<TrueForgeApi.TurnUserEventMessage> => {
    const v = RunCommand.safeParse(safeJson(p.call?.function?.arguments));
    const command = v.success ? v.data.command : String(p.call?.function?.arguments ?? "").slice(0, 200);
    const id = `cmd-${p.toolCallId}`;
    const verdict0 = commandPolicy(command);
    if (!verdict0.ok) {
      hub.push({ kind: "command", id, command, state: "denied", output: `Refused by the command policy: ${verdict0.why}.` });
      return deny(p, `Refused by the command policy: ${verdict0.why}.`);
    }
    if (autoApproveCommands()) {                                                                 // Bypass Permissions: no question, but the card is there from the start
      approvedCommands.push({ id, command, turn: turnRef.current.id });
      hub.push({ kind: "command", id, command, state: "running" });
      return allow(p);
    }
    hub.push({ kind: "command", id, command, state: "asking" });
    const verdict = await new Promise<"allow" | "deny">((resolve) => {
      pendingCommands.set(id, resolve);
      signal.addEventListener("abort", () => resolve("deny"), { once: true });
    });
    pendingCommands.delete(id);
    if (verdict === "allow") approvedCommands.push({ id, command, turn: turnRef.current.id });
    hub.push({ kind: "command", id, command, state: verdict === "allow" ? "running" : "denied" });
    return verdict === "allow" ? allow(p) : deny(p, "The user denied this command.");
  };
  const turns = new AgentTurns({
    host, review, crew, board, sessions, router, hub, specFor,
    uiMode: () => uiMode,
    cfg, serverName,
    instructions,
    packFor: (text, active, recent) => packs.packFor(text, active, recent),                  // 06
    status: { setTtft: (ms, m) => status.setTtft(ms, m) },
    turn: turnRef,
    recent: () => changedPaths,
    approveCommand, out,
    answered: (m) => catalog.noteAnswered(m),
    contextWindow: (m) => catalog.served.find((s) => s.name === m)?.contextLength ?? null,
  }, makeOnPause);

  // Where the chat lives: docked beside the editor, or filling the window. Both show the same Hub.
  const legacyDock = !supportsSecondarySidebar(vscode.version);
  void vscode.commands.executeCommand("setContext", "co4fe3.legacyDock", legacyDock);
  // The sessions sidebar's look (width, sort, group, filter) is remembered per person, in globalState: never a settings file.
  const setSidebar = (patch: Partial<SidebarPrefs>): void => {
    const next = normalizeSidebar(patch, hub.chrome.sidebar);
    void ctx.globalState.update("co4fe3.sidebar", next);
    hub.setChrome({ sidebar: next });
  };
  hub.setChrome({ sidebar: normalizeSidebar(ctx.globalState.get("co4fe3.sidebar")) });
  const afterSessionChange = (): void => {
    board.clear();
    hub.setChrome({ sessionUrl: hub.forge ? sessionUrl(cfg().trueforge.url, hub.forge.sessionId) : null });
  };
  afterSessionChange();
  const attach = (port: HubPort): vscode.Disposable => new vscode.Disposable(hub.attach(port));
  let workspaceFiles: readonly string[] = [];                                                    // the "@" menu lists every file, not only the indexed ones
  const refreshFiles = (): void => { void host.listFiles(5000).then((f) => { workspaceFiles = f; }, () => undefined); };
  refreshFiles();
  void instructions();                                                                           // "/" and "@rule:" work before the first message
  ctx.subscriptions.push(vscode.workspace.onDidCreateFiles(refreshFiles), vscode.workspace.onDidDeleteFiles(refreshFiles), vscode.workspace.onDidRenameFiles(refreshFiles));
  const onCommand = createUiCommands({
    host, hub, turns, review, applier, router, sessions, catalog,
    index: () => index.get(),
    instructionItems: async () => { try { return (await instructions()).items; } catch { return lastInstructions?.items ?? []; } },   // waits for a reload, so "/" lists files created after start-up
    files: () => workspaceFiles,
    openPaths: () => {
      const rel = (u: vscode.Uri): string | null => (u.scheme === "file" ? vscode.workspace.asRelativePath(u, false).split(path.sep).join("/") : null);
      const active = vscode.window.activeTextEditor?.document.uri;
      return [active ? rel(active) : null, ...vscode.window.visibleTextEditors.map((e) => rel(e.document.uri)), ...changedPaths].filter((p): p is string => !!p && !p.startsWith("..") && !path.isAbsolute(p));
    },
    pendingCommands, setUiMode,
    enterLayout: (l) => layout.enter(l),
    afterSessionChange, setSidebar, modelsMessage, log: (l) => out.info(l),
  });
  const dock = new DockView(ctx, attach, onCommand, (l) => out.info(l));
  const agentWindow = new AgentWindow(ctx, attach, onCommand, (l) => out.info(l));
  const dockFocus = (): Thenable<unknown> => vscode.commands.executeCommand(legacyDock ? `${DockView.legacyId}.focus` : `${DockView.id}.focus`);
  const layout = new LayoutController(ctx, {
    hideChrome: () => cfg().agentMode.hideChrome,
    openAgentWindow: () => agentWindow.open(),
    closeAgentWindow: () => agentWindow.close(),
    showDock: dockFocus,
    log: (l) => out.info(l),
    onChange: (l) => {
      hub.setChrome({ layout: l }); status.setLayout(l);
      if (l === "editor" && cfg().editor.openDiffs) void review.openPending().then(() => { for (const p of review.store.all()) if (p.by !== "inline" && p.hunks.some((h) => p.verdict[h.id] === "pending")) shownInEditor.add(p.key); });
    },
  });
  agentWindow.onUserClosed = () => void layout.enter("editor");                                    // closing the tab leaves Agent mode and puts the settings back
  void layout.recover();                                                                          // a window that died in Agent mode left its settings hidden
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DockView.id, dock, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerWebviewViewProvider(DockView.legacyId, dock, { webviewOptions: { retainContextWhenHidden: true } }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("co4fe3.pickModel", () => pickModelQuick({ catalog, router })),
    vscode.commands.registerCommand("co4fe3.resetStats", () => { router.resetStats(); refreshModel(); void vscode.window.showInformationMessage("co4fe3: model stats cleared."); }),
    vscode.commands.registerCommand("co4fe3.cycleMode", () => setUiMode(nextUiMode(uiMode))),
    vscode.commands.registerCommand("co4fe3.agentMode", () => layout.enter("agent")),
    vscode.commands.registerCommand("co4fe3.editorMode", () => layout.enter("editor")),
    vscode.commands.registerCommand("co4fe3.toggleLayout", () => layout.toggle()),
    vscode.commands.registerCommand("co4fe3.focusChat", () => layout.layout === "agent" ? agentWindow.open() : dockFocus()),
    vscode.commands.registerCommand("co4fe3.newSession", () => { if (hub.newSession()) afterSessionChange(); else void vscode.window.showInformationMessage("Stop the running request first."); }),
    vscode.commands.registerCommand("co4fe3.sessionHistory", async () => {
      const items = hub.summaries().map((s) => ({ label: s.title, description: s.id === hub.activeId ? "current" : "", id: s.id }));
      if (!items.length) return void vscode.window.showInformationMessage("No sessions yet.");
      const pick = await vscode.window.showQuickPick(items, { title: "co4fe3: sessions", placeHolder: "Open a session" });
      if (pick && pick.id !== hub.activeId && await hub.switchTo(pick.id)) afterSessionChange();
    }),
    vscode.commands.registerCommand("co4fe3.openSession", () => { const u = hub.chrome.sessionUrl; if (u) void vscode.env.openExternal(vscode.Uri.parse(u)); }),
    vscode.commands.registerCommand("co4fe3.startTrueForge", () => {                                // runs in a neutral folder, never the user's repo
      const cwd = ctx.globalStorageUri.fsPath;
      void vscode.workspace.fs.createDirectory(ctx.globalStorageUri).then(() => {
        const t = vscode.window.createTerminal({ name: "TrueForge", cwd });
        t.show(); t.sendText(cfg().trueforge.command);
      });
    }),
  );
  if (!ctx.globalState.get<boolean>("co4fe3.dockShown")) {                                          // first run: show where the chat lives
    void ctx.globalState.update("co4fe3.dockShown", true);
    setTimeout(() => void dockFocus(), 1500);
  }
  const selectionWidget = new SelectionWidget(() => vscode.workspace.getConfiguration("co4fe3").get<boolean>("editor.selectionWidget", true));
  ctx.subscriptions.push(selectionWidget, vscode.languages.registerHoverProvider({ scheme: "file" }, selectionWidget));
  /** The selection in the active editor as a chat attachment (1-based lines), or null. Only an explicit Chat or Explain sends it anywhere. */
  const selectionToAttach = (): { path: string; start: number; end: number } | null => {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.uri.scheme !== "file") return null;
    const rel = vscode.workspace.asRelativePath(ed.document.uri, false);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;                            // a file outside the workspace is not ours to read
    const lines = selectedLines(ed.selection);                                                 // a selection that ends at column 0 does not include that line
    return { path: rel.split(path.sep).join("/"), start: lines.start + 1, end: lines.end + 1 };
  };
  const showChat = async (): Promise<void> => { if (layout.layout === "agent") agentWindow.open(); else await dockFocus(); };
  ctx.subscriptions.push(
    vscode.commands.registerCommand("co4fe3.chatSelection", async () => {                      // Ctrl+L: put the selection in the prompt box, ready for a question
      const a = selectionToAttach();
      if (a) hub.setChrome({ attached: a });
      await showChat();
      hub.broadcast({ type: "focusComposer" });
    }),
    vscode.commands.registerCommand("co4fe3.explainSelection", async () => {                   // one click: ask what the selection does, read-only, without touching the chat's mode
      const a = selectionToAttach();
      if (!a) return void vscode.window.showInformationMessage("Select some code first.");
      if (turns.busy) return void vscode.window.showInformationMessage("Wait for the current request, or stop it first.");
      await showChat();
      void turns.send("Explain this code: what it does, how it works, and where it is used in the project.", a, undefined, "ask");
    }),
  );
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
    pickModel: () => pickModelQuick({ catalog, router }),
    cfg,
  });
  shutdown = async () => {
    await layout.leave();                                                                        // never leave the user with hidden chrome
    hub.dispose();                                                                               // writes the active session
    await sessionStore.settled();
  };
}

export async function deactivate(): Promise<void> { await shutdown?.(); }

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
    vscode.commands.registerCommand("co4fe3.proposal.acceptAll", (key?: string) => decideAllAtCursor(d, "accepted", key)),
    vscode.commands.registerCommand("co4fe3.proposal.rejectAll", (key?: string) => decideAllAtCursor(d, "rejected", key)),
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
function decideAllAtCursor(d: ReviewDeps, v: "accepted" | "rejected", given?: string): void {
  let key = typeof given === "string" ? given : "";                  // a CodeLens passes the proposal's key
  if (!key) {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.uri.scheme !== "co4fe3-proposal") return;
    key = new URLSearchParams(ed.document.uri.query).get("key") ?? "";
  }
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
