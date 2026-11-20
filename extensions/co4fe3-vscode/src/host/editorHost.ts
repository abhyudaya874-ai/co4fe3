import * as vscode from "vscode";
import type { EditorHost, LspHost, Problem, SearchHit } from "@co4fe3/agent-core";
import { createLspHost } from "./lsp.js";
import { rgSearch, runCapped } from "./commands.js";

const SEV = ["error", "warning", "info", "hint"] as const;      // vscode.DiagnosticSeverity: Error=0, Warning=1, Information=2, Hint=3

/** The open buffer wins over disk, so the review shows what the user sees. null = the file does not exist. */
export async function currentText(uri: vscode.Uri): Promise<string | null> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  try { return new TextDecoder("utf-8").decode(await vscode.workspace.fs.readFile(uri)); }
  catch (e) { if (e instanceof vscode.FileSystemError && e.code === "FileNotFound") return null; throw e; }
}

export const fullRange = (doc: vscode.TextDocument): vscode.Range => new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));

export const problemsOf = (uri: vscode.Uri): Problem[] => vscode.languages.getDiagnostics(uri).map((d) => ({
  code: typeof d.code === "object" ? String(d.code.value) : String(d.code ?? d.source ?? ""),
  severity: SEV[d.severity] ?? "info", message: d.message, line: d.range.start.line,
}));

/** Waits until diagnostics for `uri` change, or `waitMs` passes. Never rejects. */
export function diagnosticsSettled(uri: vscode.Uri, waitMs: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, waitMs);
    const sub = vscode.languages.onDidChangeDiagnostics((e) => { if (e.uris.some((u) => u.toString() === uri.toString())) done(); });
    function done() { clearTimeout(t); sub.dispose(); resolve(); }
  });
}

export function createEditorHost(ctx: vscode.ExtensionContext, out: vscode.LogOutputChannel): EditorHost {
  const folder = () => vscode.workspace.workspaceFolders?.[0];
  const root = (): string => {
    const f = folder();
    if (!f) throw new Error("Open a workspace folder to use co4fe3.");
    return f.uri.fsPath;
  };
  const uriOf = (rel: string): vscode.Uri | null => {
    const f = folder();
    if (!f) return null;
    return vscode.Uri.joinPath(f.uri, rel);
  };
  const lsp = createLspHost(root);
  const host: EditorHost = {
    get root() { return root(); },
    readText: async (rel) => {
      const uri = uriOf(rel);
      if (!uri) return null;
      try { await vscode.workspace.fs.stat(uri); } catch { return null; }
      return await currentText(uri);
    },
    listFiles: async (limit = 5000) => {
      const f = folder();
      if (!f) return [];
      const uris = await vscode.workspace.findFiles("**/*", "**/{node_modules,.git,.venv,__pycache__,out,dist}/**", limit);
      return uris.map((u) => vscode.workspace.asRelativePath(u));
    },
    search: async (q, signal): Promise<SearchHit[]> => {
      const f = folder();
      if (!f) return [];
      return await rgSearch(f.uri.fsPath, q, signal);
    },
    run: async (req, signal) => await runCapped(req.command, root(), req.timeoutMs, req.maxOutputBytes, signal, req.onOutput),
    problems: async (rel, o) => {
      const uri = uriOf(rel);
      if (!uri) return [];
      if (o?.waitMs) await diagnosticsSettled(uri, o.waitMs);
      return problemsOf(uri);
    },
    lsp,
    now: () => Date.now(),
  };
  return host;
}
