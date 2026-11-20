import * as vscode from "vscode";
import * as path from "node:path";
import type { ReviewStore, Proposal, Decision } from "@co4fe3/agent-core";
import { proposalUri, SCHEME, ProposalDocs } from "./proposalDocs.js";
import { HunkLens } from "./hunkLens.js";

export interface ReviewController {
  readonly store: ReviewStore;
  readonly docs: ProposalDocs;
  readonly lens: HunkLens;
  /** Stages `p`, opens the diff (unless `open: false`: the chat's diff card is the review surface), resolves when no hunk is pending. On abort: closes the diff, drops the proposal, rejects. */
  review(p: Proposal, signal: AbortSignal, o?: { focus?: boolean; open?: boolean }): Promise<Decision>;
  /** Inline edit: open the diff at once with the right side equal to the file, then stream into it. */
  showStreaming(rel: string, key: string, before: string): Promise<void>;
  /** Inline edit: show streaming text on the right side before hunks exist. */
  preview(rel: string, key: string, text: string): void;
  closeStreaming(rel: string, key: string, message?: string): void;
  closeTurn(turnId: string): void;
  /** Closes the diff tab of one proposal (decided, applied or dropped). */
  close(key: string): Promise<void>;
  /** Opens one staged proposal's diff, without taking focus. */
  show(key: string): Promise<void>;
  /** Opens the diff of every proposal still waiting for a decision (switching from Agent mode to the editor). Never takes focus. */
  openPending(): Promise<void>;
  /** Opens the real file at `line` (0-based) without taking focus: the result of an accepted edit. */
  reveal(rel: string, line: number): Promise<void>;
  refresh(rel: string, key: string): void;
}

export function createReviewController(ctx: vscode.ExtensionContext, deps: { store: ReviewStore; root: string }): ReviewController {
  const live = new Map<string, string>();
  const docs = new ProposalDocs(deps.store, live);
  const lens = new HunkLens(deps.store);
  ctx.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, docs));
  ctx.subscriptions.push(vscode.languages.registerCodeLensProvider({ scheme: SCHEME }, lens));

  const open = async (p: Proposal, focus: boolean): Promise<void> => {
    const left = p.before === null ? proposalUri(p.path, p.key, "empty") : vscode.Uri.file(path.join(deps.root, p.path));
    await vscode.commands.executeCommand("vscode.diff", left, proposalUri(p.path, p.key), `${path.basename(p.path)} ↔ proposed by ${p.by}`, { preview: false, preserveFocus: !focus });
  };

  return {
    store: deps.store, docs, lens,
    async review(p, signal, o) {
      deps.store.stage(p);
      if (o?.open !== false) await open(p, o?.focus ?? false);
      try {
        const d = await deps.store.settled(p.key, signal);
        return d;
      } catch (e) {
        await closeDocByKey(p.key);
        deps.store.dropTurn(p.turnId);
        throw e;
      }
    },
    async showStreaming(rel, key, before) {
      live.set(key, before);                                   // the right side starts equal to the file
      const left = vscode.Uri.file(path.join(deps.root, rel));
      await vscode.commands.executeCommand("vscode.diff", left, proposalUri(rel, key), `${path.basename(rel)} ↔ co4fe3 inline edit`, { preview: false, preserveFocus: true });
    },
    preview(rel, key, text) {
      live.set(key, text);
      docs.refresh(rel, key);
    },
    closeStreaming(rel, key, message) {
      live.delete(key);
      docs.refresh(rel, key);
      if (message) void vscode.window.showInformationMessage(message);
    },
    async close(key) { await closeDocByKey(key); },
    async show(key) { const p = deps.store.get(key); if (p) await open(p, false); },
    async openPending() {
      for (const p of deps.store.all()) {
        if (p.by === "inline" || !p.hunks.some((h) => p.verdict[h.id] === "pending")) continue;
        await open(p, false);
      }
    },
    async reveal(rel, line) {
      const uri = vscode.Uri.file(path.join(deps.root, rel));
      await vscode.window.showTextDocument(uri, { preview: false, preserveFocus: true, selection: new vscode.Range(line, 0, line, 0) });
    },
    async closeTurn(turnId) {
      for (const key of deps.store.dropTurn(turnId)) await closeDocByKey(key);
    },
    refresh(rel, key) {
      docs.refresh(rel, key);
      lens.refresh();
    },
  };
}

/** A diff tab has `original` and `modified`, not `uri`; a plain proposal document has `uri`. Any of them may carry the key. */
const closeDocByKey = async (key: string): Promise<void> => {
  for (const group of vscode.window.tabGroups.all) {
    const doomed = group.tabs.filter((tab) => {
      const input = tab.input as { uri?: vscode.Uri; original?: vscode.Uri; modified?: vscode.Uri } | undefined;
      return [input?.uri, input?.original, input?.modified].some((u) => !!u && u.scheme === SCHEME && u.query.includes(`key=${key}`));
    });
    if (doomed.length) await vscode.window.tabGroups.close(doomed, true);
  }
};
