---
description: Build per-hunk review end to end - pure hunks/edits/store/checkpoints in agent-core, then the proposal diff editor, CodeLens accept/reject, the single writer and Undo in the extension
argument-hint: ""
---

# 03 Review core (A1 + B2: per-hunk decisions and a working Undo)

Goal: any `Proposal` can be shown as a diff with ✓/✗ on every hunk, written through `Applier` only when decided, and
undone byte for byte. Both Task A and Task B use this.

## 1. Pure core first (agent-core), with tests before code

Implement rule 30 exactly: `review/lines.ts`, `hunks.ts`, `edits.ts`, `store.ts`, `checkpoints.ts`, `util/jail.ts`,
`util/stable.ts`. Add the one helper the editor needs to place lenses:

```ts
/** 0-based line in the preview text (before + included hunks) where each hunk starts. */
export function previewLines(hunks: readonly Hunk[], include: ReadonlySet<string>): Map<string, number> {
  const at = new Map<string, number>();
  let delta = 0;
  for (const h of [...hunks].sort((a, b) => a.oldStart - b.oldStart)) {
    at.set(h.id, h.oldStart + delta);
    if (include.has(h.id)) delta += h.newLines.length - h.oldLines.length;
  }
  return at;
}
```

`CheckpointLog` (pure):

```ts
export interface Checkpoint { id: string; path: string; before: string | null; after: string; turnId: string; reason: string; at: number; undone: boolean }
export class CheckpointLog {
  constructor(private now: () => number = Date.now, private items: Checkpoint[] = []) {}
  push(c: Omit<Checkpoint, "id" | "at" | "undone">): Checkpoint { const cp = { ...c, id: `cp${this.items.length + 1}-${this.now().toString(36)}`, at: this.now(), undone: false }; this.items.push(cp); return cp; }
  get(id: string): Checkpoint | undefined { return this.items.find((c) => c.id === id); }
  last(): Checkpoint | undefined { return [...this.items].reverse().find((c) => !c.undone); }
  ofTurn(turnId: string): Checkpoint[] { return this.items.filter((c) => c.turnId === turnId && !c.undone).reverse(); }  // newest first, for "revert turn"
  markUndone(id: string): void { const c = this.get(id); if (c) c.undone = true; }
  toJSON(): Checkpoint[] { return this.items.slice(-200); }
}
```

## 2. The proposal document (`extensions/…/src/review/proposalDocs.ts`)

```ts
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
```

## 3. Per-hunk CodeLens (`review/hunkLens.ts`)

```ts
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
    return p.hunks.filter((h) => p.verdict[h.id] === "pending").flatMap((h, i, all) => {
      const r = new vscode.Range(at.get(h.id)!, 0, at.get(h.id)!, 0);
      return [
        new vscode.CodeLens(r, { title: `✓ Accept (Alt+Y)`, command: "co4fe3.hunk.accept", arguments: [key, h.id] }),
        new vscode.CodeLens(r, { title: `✗ Reject (Alt+N)`, command: "co4fe3.hunk.reject", arguments: [key, h.id] }),
        new vscode.CodeLens(r, { title: `hunk ${i + 1}/${all.length} · ${p.by}: ${p.why}`, command: "" }),
      ];
    });
  }
  refresh(): void { this.changed.fire(); }
}
// registration: vscode.languages.registerCodeLensProvider({ scheme: SCHEME }, lens)
```

CodeLens inside diff editors needs `"diffEditor.codeLens": true`, which the extension contributes through
`configurationDefaults`. **Verify it in the Extension Development Host on day one.** If the lenses do not show, the
same accept/reject controls exist in three other places: the editor-title buttons (`Accept all` / `Reject all`),
the Alt+Y / Alt+N keybindings at the cursor, and the panel's diff card. The review never depends on one surface.

## 4. The controller (`review/controller.ts`)

```ts
export interface ReviewController {
  readonly store: ReviewStore;
  /** Stages `p`, opens the diff, resolves when no hunk is pending. On abort: closes the diff, drops the proposal, rejects. */
  review(p: Proposal, signal: AbortSignal, o?: { focus?: boolean }): Promise<Decision>;
  /** Inline edit: show streaming text on the right side before hunks exist. */
  preview(rel: string, key: string, text: string): void;
  closeTurn(turnId: string): void;
}

async function open(p: Proposal, focus: boolean): Promise<void> {
  const left = p.before === null ? proposalUri(p.path, p.key, "empty") : vscode.Uri.file(join(root, p.path));
  await vscode.commands.executeCommand("vscode.diff", left, proposalUri(p.path, p.key), `${basename(p.path)} ↔ proposed by ${p.by}`, { preview: false, preserveFocus: !focus });
}
```

Commands (all registered in `extension.ts`; contributes in the `vscode-extension` skill):

| Command | What it does |
|---|---|
| `co4fe3.hunk.accept` / `.reject` (key, hunkId) | `store.decide`, then refresh the doc, the lenses and the panel |
| `co4fe3.hunk.acceptAtCursor` / `.rejectAtCursor` (Alt+Y / Alt+N) | finds the hunk under the cursor via `previewLines` |
| `co4fe3.proposal.acceptAll` / `.rejectAll` (editor title) | `store.decideAll` |
| `co4fe3.undoLast` | `applier.undo(log.last().id)` → "Restored helpers.py" |
| `co4fe3.revertTurn` (turnId) | undoes `log.ofTurn(turnId)`, newest first |

After every successful apply, show `window.showInformationMessage("Applied 2 of 3 hunks to helpers.py", "Undo")`
(non-modal) and an `↶ Undo` status-bar item for 30 s. Both call `applier.undo(id)`.

## 5. A dev command to exercise it before any model exists

`co4fe3.dev.sampleProposal` (only registered when `ExtensionMode.Development`) builds a proposal for the active file
(uppercase line 2, delete line 5, append a line), with `baseline: await host.problems(rel)`, and calls `review(...)`.
Use it to watch the whole loop.

Also build `review/verify.ts` (rule 30, with its tests) in this workflow. It is pure, and the propose_edit handler
(workflow 02) and inline edit (workflow 04) both use it.

## Exit check

- Unit: `hunks` (property), `edits` (every `EditReject` reason), `store` (`settled` resolves only when nothing is
  pending; `take` is one-shot; `dropTurn`), `checkpoints`, `verify`, `jail`, `previewLines`, all green.
- Extension Development Host, on `test/fixtures/minipkg/src/minipkg/helpers.py`:
  1. Run the dev command. The diff shows 3 hunks with lenses.
  2. Accept h1, reject h2, accept h3. The file has exactly h1 and h3, and is saved.
  3. Undo. The file is byte-identical to before (`git diff --stat` is empty).
- Record a 10-second screen capture of steps 2–3 into `docs/progress/03-review.md` (it is the B2 evidence).
- Commit: `review: per-hunk diff review, single writer, checkpoints and undo`
