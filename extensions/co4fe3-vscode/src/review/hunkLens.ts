import * as vscode from "vscode";
import type { ReviewStore } from "@co4fe3/agent-core";
import { previewLines } from "@co4fe3/agent-core";

export class HunkLens implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  constructor(private store: ReviewStore) {}
  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const key = new URLSearchParams(doc.uri.query).get("key") ?? "";
    const p = this.store.get(key);
    if (!p) return [];
    const shown = new Set(p.hunks.filter((h) => p.verdict[h.id] !== "rejected").map((h) => h.id));
    const at = previewLines(p.hunks, shown);
    const pending = p.hunks.filter((h) => p.verdict[h.id] === "pending");
    const top = new vscode.Range(0, 0, 0, 0);
    const file = pending.length === 0 ? [] : [                                              // the whole file at once, like Devin's "Accept File / Reject File"
      new vscode.CodeLens(top, { title: `$(check-all) Accept file (Alt+Shift+Y)`, command: "co4fe3.proposal.acceptAll", arguments: [key] }),
      new vscode.CodeLens(top, { title: `$(close-all) Reject file`, command: "co4fe3.proposal.rejectAll", arguments: [key] }),
      new vscode.CodeLens(top, { title: `${pending.length} edit${pending.length === 1 ? "" : "s"} · ${p.by}`, command: "" }),
    ];
    return [...file, ...pending.flatMap((h, i, all) => {
      const r = new vscode.Range(at.get(h.id)!, 0, at.get(h.id)!, 0);
      return [
        new vscode.CodeLens(r, { title: `✓ Accept (Alt+Y)`, command: "co4fe3.hunk.accept", arguments: [key, h.id] }),
        new vscode.CodeLens(r, { title: `✗ Reject (Alt+N)`, command: "co4fe3.hunk.reject", arguments: [key, h.id] }),
        new vscode.CodeLens(r, { title: `hunk ${i + 1}/${all.length} · ${p.by}: ${p.why}`, command: "" }),
      ];
    })];
  }
  refresh(): void { this.changed.fire(); }
}
