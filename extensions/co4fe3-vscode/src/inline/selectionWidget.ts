import * as vscode from "vscode";

const MAC = process.platform === "darwin";
export const KEY = { edit: MAC ? "⌘I" : "Ctrl+I", chat: MAC ? "⌘L" : "Ctrl+L" };

/**
 * The actions that appear next to selected text: Edit, Chat, Explain. The editor API cannot draw a floating overlay, so
 * this uses the editor's own hover widget: it opens beside the selection a moment after you select with the mouse, floats
 * in view whatever the line length, and every item is a one-click command. Nothing goes to the chat until you choose Chat.
 */
export class SelectionWidget implements vscode.HoverProvider, vscode.Disposable {
  private timer: NodeJS.Timeout | undefined;
  private readonly subs: vscode.Disposable[] = [];

  constructor(private enabled: () => boolean) {
    this.subs.push(vscode.window.onDidChangeTextEditorSelection((e) => {
      clearTimeout(this.timer);
      const ed = e.textEditor;
      if (!this.enabled() || e.kind !== vscode.TextEditorSelectionChangeKind.Mouse || ed.selection.isEmpty || ed.selections.length > 1) return;   // a keyboard or command selection is not a request
      if (ed !== vscode.window.activeTextEditor || ed.document.uri.scheme !== "file") return;
      const shown = ed.selection;
      this.timer = setTimeout(() => {
        const now = vscode.window.activeTextEditor;
        if (now === ed && now.selection.isEqual(shown)) void vscode.commands.executeCommand("editor.action.showHover");   // still selected: open the widget
      }, 380);
    }));
  }

  /** Our content for a position inside (or at the end of) the current selection. */
  provideHover(doc: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const ed = vscode.window.activeTextEditor;
    if (!this.enabled() || !ed || ed.document !== doc || ed.selection.isEmpty || ed.selections.length > 1) return undefined;
    if (!ed.selection.contains(position) && !ed.selection.end.isEqual(position)) return undefined;
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = { enabledCommands: ["co4fe3.inlineEdit", "co4fe3.chatSelection", "co4fe3.explainSelection"] };
    md.supportHtml = true;
    const dim = (t: string): string => `<span style="color:var(--vscode-descriptionForeground);">${t}</span>`;
    md.appendMarkdown(`[$(edit) Edit](command:co4fe3.inlineEdit "Edit the selection with co4fe3") ${dim(KEY.edit)}`);
    md.appendMarkdown(`&nbsp;&nbsp;&nbsp;[$(comment-discussion) Chat](command:co4fe3.chatSelection "Add the selection to the chat") ${dim(KEY.chat)}`);
    md.appendMarkdown(`&nbsp;&nbsp;&nbsp;[$(lightbulb) Explain](command:co4fe3.explainSelection "Explain the selection")`);
    return new vscode.Hover(md);
  }

  dispose(): void { clearTimeout(this.timer); this.subs.forEach((s) => s.dispose()); }
}
