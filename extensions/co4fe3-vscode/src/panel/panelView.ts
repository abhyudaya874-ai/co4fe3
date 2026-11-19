import * as vscode from "vscode";
import type { UiCommand } from "@co4fe3/agent-core/panel";
import { randomBytes } from "node:crypto";
import { Bridge } from "./bridge.js";

export class PanelView implements vscode.WebviewViewProvider {
  static readonly id = "co4fe3.panel";
  bridge: Bridge | null = null;
  private view: vscode.WebviewView | null = null;
  onCommand: (m: UiCommand) => void = () => undefined;

  constructor(private ctx: vscode.ExtensionContext) {}

  /** Out-of-band messages that are not transcript events (completion lists). */
  completions(kind: "@" | "/", items: string[]): void {
    void this.view?.webview.postMessage({ type: "completions", kind, items });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = randomBytes(16).toString("base64");
    const js = view.webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.js")), css = view.webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.css"));
    view.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.webview.cspSource} data:; style-src ${view.webview.cspSource}; font-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${css}"></head><body><div id="root"></div><script nonce="${nonce}" src="${js}"></script></body></html>`;
    this.bridge = new Bridge((b) => view.webview.postMessage({ type: "events", batch: b }));
    view.webview.onDidReceiveMessage((m: UiCommand) => this.onCommand(m));   // validate `m.type` with a switch + assertNever
  }
}
// registration: vscode.window.registerWebviewViewProvider(PanelView.id, view, { webviewOptions: { retainContextWhenHidden: true } })
