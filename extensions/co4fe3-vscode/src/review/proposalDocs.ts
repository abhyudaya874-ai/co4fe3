import * as vscode from "vscode";
import type { ReviewStore } from "@co4fe3/agent-core";
import { applyHunks } from "@co4fe3/agent-core";

export const SCHEME = "co4fe3-proposal";
export const proposalUri = (rel: string, key: string, side: "right" | "empty" = "right") =>
  vscode.Uri.from({ scheme: SCHEME, path: `/${rel}`, query: `key=${key}&side=${side}` });

export class ProposalDocs implements vscode.TextDocumentContentProvider {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;
  constructor(private store: ReviewStore, private live: Map<string, string>) {}   // live: streaming previews (inline edit)
  provideTextDocumentContent(uri: vscode.Uri): string {
    const q = new URLSearchParams(uri.query), key = q.get("key") ?? "";
    if (q.get("side") === "empty") return "";
    const streaming = this.live.get(key);
    if (streaming !== undefined) return streaming;
    const p = this.store.get(key);
    if (!p) return "";
    const shown = new Set(p.hunks.filter((h) => p.verdict[h.id] !== "rejected").map((h) => h.id));   // pending + accepted
    return applyHunks(p.before ?? "", p.hunks, shown);
  }
  refresh(rel: string, key: string): void { this.changed.fire(proposalUri(rel, key)); }
}
