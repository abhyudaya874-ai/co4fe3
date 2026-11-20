import * as vscode from "vscode";
import { proposalEvent, type Proposal } from "@co4fe3/agent-core";
import type { HunkView } from "@co4fe3/agent-core/panel";

export const CONTROLLER_ID = "co4fe3-inline";
/** Thread context values (the `commentThread` key in menu `when` clauses). */
const REVIEWING = "co4fe3.review";

/**
 * The in-editor widget for Ctrl+Alt+K, built on VS Code's native comment box (the same one that opens for "Add Comment"):
 * it opens over the selected lines with the cursor in it, takes the instruction there, and then becomes the review, one
 * diff per change with Accept and Reject buttons. The box is the editor's own, so typing never reaches the file.
 */
export class InlineWidget implements vscode.Disposable {
  private ctl: vscode.CommentController;
  private armed: { uri: string; range: vscode.Range; timer: NodeJS.Timeout } | null = null;
  private provider: vscode.CommentingRangeProvider = {
    provideCommentingRanges: (doc) => (this.armed && doc.uri.toString() === this.armed.uri ? [this.armed.range] : []),
  };

  constructor(private h: { placeholder(): string }) {
    this.ctl = vscode.comments.createCommentController(CONTROLLER_ID, "co4fe3");
    this.ctl.commentingRangeProvider = this.provider;
    this.ctl.options = { placeHolder: h.placeholder(), prompt: "Describe the change" };
  }

  /** Selects the lines, allows a comment on exactly them, and opens the native box with the cursor in it. */
  async open(ed: vscode.TextEditor, start: number, end: number): Promise<void> {
    this.disarm();
    const range = new vscode.Range(start, 0, end, ed.document.lineAt(end).range.end.character);
    ed.selection = new vscode.Selection(range.start, range.end);                 // the box anchors to the selection
    ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    this.armed = { uri: ed.document.uri.toString(), range, timer: setTimeout(() => this.disarm(), 90_000) };
    this.ctl.options = { placeHolder: this.h.placeholder(), prompt: "Describe the change" };
    this.ctl.commentingRangeProvider = this.provider;                            // VS Code asks the provider again
    await new Promise((r) => setTimeout(r, 300));                                // …and needs a moment to apply the answer
    await vscode.commands.executeCommand("workbench.action.addComment");
  }

  /** Nothing is commentable any more: the gutter shows no "+" on those lines. */
  disarm(): void {
    if (!this.armed) return;
    clearTimeout(this.armed.timer);
    this.armed = null;
    this.ctl.commentingRangeProvider = this.provider;
  }

  setPlaceholder(): void { this.ctl.options = { placeHolder: this.h.placeholder(), prompt: "Describe the change" }; }

  dispose(): void { this.disarm(); this.ctl.dispose(); }
}

/** One run's thread: shows the draft streaming in, then the changes for review. */
export class ThreadView {
  private hunks: { id: string; title: string }[] = [];

  constructor(readonly thread: vscode.CommentThread, private lang: string) {
    thread.canReply = false;                                                      // the instruction was taken; the box turns into the review
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
  }

  label(text: string): void { this.thread.label = `co4fe3 · ${text}`; }

  /** The model's code so far. */
  preview(code: string): void {
    const shown = code.length > 4000 ? `${code.slice(0, 4000)}\n…` : code;
    this.thread.comments = [comment(fenced(this.lang, shown), "Drafting…", "co4fe3.draft")];
  }

  /** One comment per change, each a diff, with Accept and Reject buttons until it is decided. */
  show(p: Proposal): void {
    const view = proposalEvent(p);
    this.hunks = view.hunks.map((h, i) => ({ id: h.id, title: `Change ${i + 1} of ${view.hunks.length}` }));
    this.thread.contextValue = REVIEWING;
    this.render(p, view.hunks);
  }

  /** The verdicts changed: relabel the comments and take the buttons off the decided ones. */
  update(p: Proposal): void { this.render(p, proposalEvent(p).hunks); }

  private render(p: Proposal, hunks: HunkView[]): void {
    this.thread.comments = hunks.map((h, i) => {
      const v = p.verdict[h.id] ?? "pending";
      return comment(fenced("diff", diffText(h)), this.hunks[i]?.title ?? h.id, v === "pending" ? "co4fe3.hunk" : "co4fe3.hunk.done", v === "pending" ? undefined : v);
    });
  }

  /** Which change a button press was on. VS Code hands back the comment; its author name is the change's title. */
  hunkOf(arg: unknown): string | undefined {
    const name = (arg as { author?: { name?: string } } | undefined)?.author?.name;
    return this.hunks.find((h) => h.title === name)?.id;
  }

  dispose(): void { this.thread.dispose(); }
}

/** A fence longer than any run of backticks in the body, so code that contains ``` cannot end it early. */
export function fenced(lang: string, body: string): vscode.MarkdownString {
  const longest = Math.max(2, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return new vscode.MarkdownString(`${fence}${lang}\n${body}\n${fence}\n`);
}

/** The unified-diff text of one change, with its context lines. */
export function diffText(h: HunkView): string {
  return [...(h.before ?? []).map((l) => ` ${l}`), ...h.oldLines.map((l) => `-${l}`), ...h.newLines.map((l) => `+${l}`), ...(h.after ?? []).map((l) => ` ${l}`)].join("\n");
}

function comment(body: vscode.MarkdownString, name: string, contextValue: string, label?: string): vscode.Comment {
  return { body, mode: vscode.CommentMode.Preview, author: { name }, contextValue, ...(label ? { label } : {}) };
}
