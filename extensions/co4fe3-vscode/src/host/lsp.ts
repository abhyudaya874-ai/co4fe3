import * as vscode from "vscode";
import * as path from "node:path";
import type { LspCall, LspHost, LspLocation, LspSymbol } from "@co4fe3/agent-core";

/** Language features through VS Code's built-in commands (rule 10's LspHost). Every method resolves [] when no provider answers. */
export function createLspHost(root: () => string): LspHost {
  const uriOf = (rel: string): vscode.Uri => vscode.Uri.joinPath(vscode.Uri.file(root()), rel);
  const withCeiling = async <T>(p: Thenable<T>, ms = 1500): Promise<T | null> =>
    await Promise.race([Promise.resolve(p), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  const relOf = (uri: vscode.Uri): string | null => {
    const f = vscode.workspace.workspaceFolders?.[0];
    if (!f) return null;
    const rel = path.relative(f.uri.fsPath, uri.fsPath).split(path.sep).join("/");
    return rel.startsWith("..") || path.isAbsolute(rel) ? null : rel;   // outside-root hits are dropped
  };
  return {
    documentSymbols: async (rel: string): Promise<LspSymbol[]> => {
      const syms = await withCeiling(vscode.commands.executeCommand<(vscode.SymbolInformation | vscode.DocumentSymbol)[]>("vscode.executeDocumentSymbolProvider", uriOf(rel)));
      const out: LspSymbol[] = [];
      const flat = (list: readonly vscode.DocumentSymbol[], parent?: string): void => {
        for (const s of list) {
          out.push({ name: s.name, kind: String(s.kind), line: s.range.start.line, endLine: s.range.end.line, col: s.range.start.character, parent });
          flat(s.children, s.name);
        }
      };
      for (const s of syms ?? []) {
        if ("children" in s) flat([s as vscode.DocumentSymbol]);
        else out.push({ name: s.name, kind: String(s.kind), line: (s as vscode.SymbolInformation).location.range.start.line, endLine: (s as vscode.SymbolInformation).location.range.end.line, col: (s as vscode.SymbolInformation).location.range.start.character });
      }
      return out;
    },
    references: async (rel: string, line: number, col: number): Promise<LspLocation[]> => {
      const locs = await withCeiling(vscode.commands.executeCommand<vscode.Location[]>("vscode.executeReferenceProvider", uriOf(rel), new vscode.Position(line, col)));
      return (locs ?? []).map((l) => ({ path: relOf(l.uri) ?? "", line: l.range.start.line })).filter((l) => l.path !== "");
    },
    incomingCalls: async (rel: string, line: number, col: number): Promise<LspCall[]> => {
      const items = await withCeiling(vscode.commands.executeCommand<vscode.CallHierarchyItem[]>("vscode.prepareCallHierarchy", uriOf(rel), new vscode.Position(line, col)));
      if (!items?.length) return [];
      const calls = await withCeiling(vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>("vscode.provideIncomingCalls", items[0]!));
      return (calls ?? []).map((c) => ({ from: c.from.name, path: relOf(c.from.uri) ?? "", line: c.from.selectionRange.start.line })).filter((c) => c.path !== "");
    },
    hover: async (rel: string, line: number, col: number): Promise<string[]> => {
      const hovers = await withCeiling(vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", uriOf(rel), new vscode.Position(line, col)));
      const out: string[] = [];
      for (const h of hovers ?? []) {
        for (const c of h.contents) {
          if (c instanceof vscode.MarkdownString) out.push(c.value);
          else if (typeof c === "string") out.push(c);
          else out.push(`${typeof c.language === "string" ? "```" + c.language + "\n" : ""}${c.value}${typeof c.language === "string" ? "\n```" : ""}`);
        }
      }
      return out;
    },
  };
}
