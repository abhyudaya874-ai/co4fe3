import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { parseUiCommand, type UiCommand, type HubPort, type HostMessage } from "@co4fe3/agent-core/panel";

/** Which shape the one React app takes: `agent` = the full-window view with the session sidebar, `dock` = the narrow chat beside the editor. */
export type Surface = "agent" | "dock";

/** What the host does with a command, and where to answer if the answer is for that webview alone (completions). */
export type CommandHandler = (m: UiCommand, from: { port: HubPort; surface: Surface }) => void;

/** The page both surfaces load. The CSP allows only our own script (by nonce), our stylesheet and data: images. */
export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, surface: Surface): string {
  const media = vscode.Uri.joinPath(extensionUri, "media");
  const nonce = randomBytes(16).toString("base64");
  const js = webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.js"));
  const css = webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.css"));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${css}"></head><body data-surface="${surface}"><div id="root"></div><script nonce="${nonce}" src="${js}"></script></body></html>`;
}

/** Posts to one webview. A webview that was just disposed must not throw into the Hub. */
const portOf = (webview: vscode.Webview): HubPort => ({ post: (m: HostMessage) => { void Promise.resolve(webview.postMessage(m)).catch(() => undefined); } });

function listen(webview: vscode.Webview, surface: Surface, port: HubPort, onCommand: CommandHandler, log: (l: string) => void): vscode.Disposable {
  return webview.onDidReceiveMessage((raw: unknown) => {
    const m = parseUiCommand(raw);                                        // the webview is untrusted input: unknown or malformed messages are dropped
    if (!m) { log(`webview (${surface}) sent an invalid message: ${JSON.stringify(raw)?.slice(0, 120)}`); return; }
    onCommand(m, { port, surface });
  });
}

/** The chat docked beside the editor (secondary sidebar; the activity bar on VS Code older than 1.106). */
export class DockView implements vscode.WebviewViewProvider {
  static readonly id = "co4fe3.dock";
  static readonly legacyId = "co4fe3.panel";
  private view: vscode.WebviewView | null = null;

  constructor(private ctx: vscode.ExtensionContext, private attach: (port: HubPort) => vscode.Disposable, private onCommand: CommandHandler, private log: (l: string) => void) {}

  get visible(): boolean { return this.view?.visible ?? false; }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = webviewHtml(view.webview, this.ctx.extensionUri, "dock");
    const port = portOf(view.webview);
    const off = this.attach(port);
    const sub = listen(view.webview, "dock", port, this.onCommand, this.log);
    view.onDidDispose(() => { off.dispose(); sub.dispose(); if (this.view === view) this.view = null; });
  }
}

/** The full-window Agent view: one webview panel in the first editor group. Closing its tab leaves Agent mode. */
export class AgentWindow {
  static readonly id = "co4fe3.agent";
  private panel: vscode.WebviewPanel | null = null;
  private closing = false;
  /** Fires when the user closes the tab (not when `close()` does). */
  onUserClosed: () => void = () => undefined;

  constructor(private ctx: vscode.ExtensionContext, private attach: (port: HubPort) => vscode.Disposable, private onCommand: CommandHandler, private log: (l: string) => void) {}

  get isOpen(): boolean { return this.panel !== null; }

  open(): void {
    if (this.panel) { this.panel.reveal(vscode.ViewColumn.One, false); return; }
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel(AgentWindow.id, "co4fe3", { viewColumn: vscode.ViewColumn.One, preserveFocus: false }, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media],
    });
    panel.iconPath = vscode.Uri.joinPath(media, "icon.png");
    panel.webview.html = webviewHtml(panel.webview, this.ctx.extensionUri, "agent");
    const port = portOf(panel.webview);
    const off = this.attach(port);
    const sub = listen(panel.webview, "agent", port, this.onCommand, this.log);
    this.panel = panel;
    panel.onDidDispose(() => {
      off.dispose(); sub.dispose();
      const byUser = !this.closing;
      this.panel = null; this.closing = false;
      if (byUser) this.onUserClosed();
    });
  }

  close(): void {
    if (!this.panel) return;
    this.closing = true;
    this.panel.dispose();
  }
}
