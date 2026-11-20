import * as vscode from "vscode";
import * as path from "node:path";
import { jail, modelRows, completeMention, completeSlash, type EditorHost, type Applier, type InstructionSet, type RepoIndex } from "@co4fe3/agent-core";
import type { Hub, HostMessage, UiMode, LayoutId, SidebarPrefs } from "@co4fe3/agent-core/panel";
import type { AgentTurns } from "./agentTurn.js";
import type { CommandHandler } from "./panelView.js";
import type { ReviewController } from "../review/controller.js";
import type { Router } from "../forge/router.js";
import type { SessionPool } from "../forge/sessions.js";
import type { ModelCatalog } from "../forge/catalog.js";
import { proposalUri } from "../review/proposalDocs.js";
import { findPlan, implementPlanMessage, planUri } from "./planDocs.js";

export interface UiCommandDeps {
  host: EditorHost;
  hub: Hub;
  turns: AgentTurns;
  review: ReviewController;
  applier: Applier;
  router: Router;
  sessions: SessionPool;
  catalog: ModelCatalog;
  index(): RepoIndex | null;
  /** Resolves after any pending reload, so a workflow created while the window was open shows up on the first "/". */
  instructionItems(): Promise<InstructionSet["items"]>;
  /** Every workspace file (cached, refreshed on create/delete/rename), for the "@" menu. */
  files(): readonly string[];
  /** The active editor, the other visible editors, then this session's edited files: the "@" menu's "Open files". */
  openPaths(): string[];
  /** Allow / Deny answers from command cards, keyed by card id. */
  pendingCommands: Map<string, (v: "allow" | "deny") => void>;
  setUiMode(m: UiMode): void;
  enterLayout(l: LayoutId): Promise<void>;
  /** After the active session changed (new, switched, deleted): clear the crew board, refresh the TrueForge link. */
  afterSessionChange(): void;
  /** The sessions sidebar's width, sort, group and filter: validated, remembered, and sent to every window. */
  setSidebar(p: Partial<SidebarPrefs>): void;
  modelsMessage(): HostMessage;
  log(line: string): void;
}

/** Everything the webview can ask for, one case each. Messages are already validated (parseUiCommand). */
export function createUiCommands(d: UiCommandDeps): CommandHandler {
  /** Editor-side actions need the editor: leave Agent mode first, then act. */
  const inEditor = async (act: () => Thenable<unknown> | void): Promise<void> => {
    await d.enterLayout("editor");
    await act();
  };

  return (m, from) => {
    switch (m.type) {
      case "ready":
        d.hub.hello(from.port);
        from.port.post(d.modelsMessage());
        break;
      case "send": void d.turns.send(m.text, m.attach); if (d.hub.chrome.attached) d.hub.setChrome({ attached: null }); break;   // the attachment goes with the message that used it
      case "detach": d.hub.setChrome({ attached: null }); break;                                                              // the person removed the chip
      case "stop": d.turns.stop(); break;
      case "focus": { const model = d.router.order("agent")[0]; if (model) d.sessions.warm("agent", model); break; }   // lever 3: warm a spare while the user types
      case "decide": {
        const p = d.review.store.get(m.key);
        if (p) { d.review.store.decide(m.key, m.hunkId, m.verdict); d.review.refresh(p.path, m.key); }
        break;
      }
      case "decideAll": {
        const p = d.review.store.get(m.key);
        if (p) { d.review.store.decideAll(m.key, m.verdict); d.review.refresh(p.path, m.key); }
        break;
      }
      case "openDiff": {
        const p = d.review.store.get(m.key);
        if (p) void inEditor(() => vscode.commands.executeCommand("vscode.diff",
          p.before === null ? proposalUri(p.path, p.key, "empty") : vscode.Uri.file(path.join(d.host.root, p.path)), proposalUri(p.path, p.key), `${path.basename(p.path)} ↔ proposed by ${p.by}`));
        break;
      }
      case "openFile": {
        let rel: string;
        try { rel = jail(d.host.root, m.path); } catch { break; }                  // a path from the webview is jailed like any other
        const line = Math.max(0, (m.line ?? 1) - 1);
        void inEditor(() => vscode.window.showTextDocument(vscode.Uri.file(path.join(d.host.root, rel)), { selection: new vscode.Range(line, 0, line, 0) }));
        break;
      }
      case "command": {
        const resolve = d.pendingCommands.get(m.id);
        if (resolve) { d.pendingCommands.delete(m.id); resolve(m.verdict); }
        break;
      }
      case "undo": void d.applier.undo(m.checkpointId); break;
      case "revertTurn": void vscode.commands.executeCommand("co4fe3.revertTurn", m.turnId); break;
      case "plan": {                                                     // Accept: Code mode implements the plan in a new turn (edits are still reviewed)
        const p = findPlan(d.hub, m.id);
        if (!p || p.state !== "proposed") break;
        if (d.hub.chrome.busy) { d.log(`plan ${m.verdict} refused: busy`); break; }
        d.hub.push({ ...p, state: m.verdict === "accept" ? "accepted" : "rejected" });
        if (m.verdict === "accept") { d.setUiMode("code"); void d.turns.send(implementPlanMessage(p), undefined, `Implement the plan: ${p.title}`); }
        break;
      }
      case "openPlan": if (findPlan(d.hub, m.id)) void inEditor(() => vscode.window.showTextDocument(planUri(m.id), { preview: true })); break;
      case "openSession": { const url = d.hub.chrome.sessionUrl; if (url) void vscode.env.openExternal(vscode.Uri.parse(url)); break; }
      case "pickModel": void vscode.commands.executeCommand("co4fe3.pickModel"); break;
      case "setMode": d.setUiMode(m.mode); break;
      case "setModel": d.catalog.setPick(m.name); break;
      case "models": from.port.post(d.modelsMessage()); void d.catalog.refresh(); break;     // the list may have grown since TrueForge started
      case "newSession": if (d.hub.newSession()) d.afterSessionChange(); else d.log(`newSession refused: busy=${d.hub.chrome.busy}`); break;
      case "switchSession": void d.hub.switchTo(m.id).then((ok) => { if (ok) d.afterSessionChange(); else d.log(`switchSession ${m.id} refused: busy=${d.hub.chrome.busy}`); }); break;
      case "deleteSession": if (d.hub.remove(m.id)) d.afterSessionChange(); break;
      case "renameSession": void d.hub.update(m.id, { title: m.title }).then((ok) => { if (!ok) d.log(`renameSession ${m.id}: no such session`); }); break;
      case "pinSession": void d.hub.update(m.id, { pinned: m.pinned }); break;
      case "archiveSession": void d.hub.update(m.id, { archived: m.archived }); break;
      case "setSidebar": d.setSidebar(m.prefs); break;
      case "setLayout": void d.enterLayout(m.layout); break;
      case "complete": {
        const { kind, prefix } = m;
        void d.instructionItems().then((instructions) => {
          const items = kind === "@"                                   // open files, files and folders, symbols, rules and skills (Devin's @ menu)
            ? completeMention({ prefix, files: d.files(), ix: d.index(), instructions, open: d.openPaths() })
            : completeSlash(instructions, prefix);                     // "/" alone lists every workflow, then every skill
          from.port.post({ type: "completions", kind, prefix, items });   // answers the webview that asked
        });
        break;
      }
    }
  };
}

/** The status-bar model picker, for users who do not open the chat's menu. */
export async function pickModelQuick(d: Pick<UiCommandDeps, "catalog" | "router">): Promise<void> {
  await d.catalog.refresh();
  if (!d.catalog.served.length) return void vscode.window.showWarningMessage("No models from TrueForge. Is it running? (co4fe3: Start TrueForge in a terminal)");
  const rows = modelRows(d.catalog.served, d.router.statsMap(), Date.now(), d.catalog.recent);
  const AUTO = "Automatic";
  const items: (vscode.QuickPickItem & { model: string | null })[] = [
    { label: AUTO, description: "the configured order, with a fallback behind it", picked: d.catalog.pick === null, model: null },
    ...rows.map((r) => ({
      label: r.name, model: r.name, picked: d.catalog.pick === r.name,
      description: [r.p50Ms !== null ? `p50 ${(r.p50Ms / 1000).toFixed(1)} s` : "no samples", `${r.ok} ok`, r.failed ? `${r.failed} failed` : "", r.benchedMin ? `benched ${r.benchedMin} min` : ""].filter(Boolean).join(" · "),
    })),
  ];
  const pick = await vscode.window.showQuickPick(items, { title: "co4fe3: model", placeHolder: "Used first; the next model answers if it fails" });
  if (pick) d.catalog.setPick(pick.model);
}
