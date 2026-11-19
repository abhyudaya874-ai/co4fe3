---
name: vscode-extension
description: VS Code extension recipes for co4fe3 - the full package.json manifest, esbuild and Vite builds, launch configs, diff editor and CodeLens, webview CSP and theming, the bundled ripgrep, reading and writing documents
argument-hint: "<what you are wiring>"
agent: forge-editor
triggers:
  - user
  - model
---

Wiring: $ARGUMENTS

Before you use a VS Code API, find it in `node_modules/@types/vscode/index.d.ts` (`engines.vscode` is `^1.90.0`).
If you cannot find it there, it does not exist in our minimum version.

## `extensions/co4fe3-vscode/package.json` (copy whole; every command id here is in CODEMAP)

```json
{
  "name": "co4fe3-vscode",
  "displayName": "co4fe3",
  "description": "Coding agent on TrueForge: inline edit, a crew of subagents, per-hunk review, automatic model fallback.",
  "version": "0.1.0",
  "publisher": "co4fe3",
  "license": "MIT",
  "engines": { "vscode": "^1.90.0" },
  "main": "./out/extension.cjs",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "co4fe3.inlineEdit", "title": "Edit selection", "category": "co4fe3" },
      { "command": "co4fe3.inlineCancel", "title": "Cancel inline edit", "category": "co4fe3" },
      { "command": "co4fe3.hunk.accept", "title": "Accept hunk", "category": "co4fe3" },
      { "command": "co4fe3.hunk.reject", "title": "Reject hunk", "category": "co4fe3" },
      { "command": "co4fe3.hunk.acceptAtCursor", "title": "Accept hunk at cursor", "category": "co4fe3" },
      { "command": "co4fe3.hunk.rejectAtCursor", "title": "Reject hunk at cursor", "category": "co4fe3" },
      { "command": "co4fe3.proposal.acceptAll", "title": "Accept all hunks", "category": "co4fe3", "icon": "$(check-all)" },
      { "command": "co4fe3.proposal.rejectAll", "title": "Reject all hunks", "category": "co4fe3", "icon": "$(close-all)" },
      { "command": "co4fe3.undoLast", "title": "Undo last applied change", "category": "co4fe3" },
      { "command": "co4fe3.revertTurn", "title": "Revert this turn's changes", "category": "co4fe3" },
      { "command": "co4fe3.pickModel", "title": "Choose models", "category": "co4fe3" },
      { "command": "co4fe3.cycleMode", "title": "Cycle mode (Agent / Ask / Plan)", "category": "co4fe3" },
      { "command": "co4fe3.resetStats", "title": "Reset model stats", "category": "co4fe3" },
      { "command": "co4fe3.openSession", "title": "Open session in TrueForge", "category": "co4fe3" },
      { "command": "co4fe3.startTrueForge", "title": "Start TrueForge in a terminal", "category": "co4fe3" },
      { "command": "co4fe3.dev.sampleProposal", "title": "Dev: sample proposal", "category": "co4fe3" },
      { "command": "co4fe3.dev.rank", "title": "Dev: rank files for a prompt", "category": "co4fe3" }
    ],
    "keybindings": [
      { "command": "co4fe3.inlineEdit", "key": "ctrl+alt+k", "mac": "cmd+alt+k", "when": "editorTextFocus && !co4fe3.inlineBusy" },
      { "command": "co4fe3.inlineCancel", "key": "escape", "when": "co4fe3.inlineBusy" },
      { "command": "co4fe3.hunk.acceptAtCursor", "key": "alt+y", "when": "resourceScheme == co4fe3-proposal" },
      { "command": "co4fe3.hunk.rejectAtCursor", "key": "alt+n", "when": "resourceScheme == co4fe3-proposal" },
      { "command": "co4fe3.proposal.acceptAll", "key": "alt+shift+y", "when": "resourceScheme == co4fe3-proposal" },
      { "command": "co4fe3.cycleMode", "key": "ctrl+.", "mac": "cmd+.", "when": "focusedView == co4fe3.panel" }
    ],
    "menus": {
      "editor/title": [
        { "command": "co4fe3.proposal.acceptAll", "when": "resourceScheme == co4fe3-proposal", "group": "navigation@1" },
        { "command": "co4fe3.proposal.rejectAll", "when": "resourceScheme == co4fe3-proposal", "group": "navigation@2" }
      ],
      "commandPalette": [
        { "command": "co4fe3.hunk.accept", "when": "false" },
        { "command": "co4fe3.hunk.reject", "when": "false" },
        { "command": "co4fe3.dev.sampleProposal", "when": "co4fe3.devMode" },
        { "command": "co4fe3.dev.rank", "when": "co4fe3.devMode" }
      ]
    },
    "viewsContainers": { "activitybar": [{ "id": "co4fe3", "title": "co4fe3", "icon": "media/icon.svg" }] },
    "views": { "co4fe3": [{ "type": "webview", "id": "co4fe3.panel", "name": "Agent" }] },
    "configuration": {
      "title": "co4fe3",
      "properties": {
        "co4fe3.trueforge.url": { "type": "string", "default": "http://localhost:8790", "description": "TrueForge local server." },
        "co4fe3.trueforge.command": { "type": "string", "default": "npm run trueforge", "description": "Command run by 'Start TrueForge in a terminal'." },
        "co4fe3.models.order": { "type": "array", "items": { "type": "string" }, "default": [], "markdownDescription": "Model FQNs as TrueForge lists them; the first is the primary. Empty: the first two models TrueForge lists." },
        "co4fe3.mode": { "type": "string", "enum": ["agent", "ask", "plan"], "default": "agent", "markdownDescription": "Agent edits (with review); Ask and Plan are read-only. Applies to the next chat session." },
        "co4fe3.crew.enabled": { "type": "boolean", "default": true, "description": "Let the lead agent delegate to subagents." },
        "co4fe3.context.packTokens": { "type": "number", "default": 6000, "minimum": 1000, "maximum": 12000 },
        "co4fe3.latency.autoOrderInline": { "type": "boolean", "default": true, "description": "Order inline-edit models by measured time to first token." },
        "co4fe3.latency.hedgeInline": { "type": "boolean", "default": true, "description": "Start the next model if the first is slow to start streaming." },
        "co4fe3.commands.timeoutSeconds": { "type": "number", "default": 120, "minimum": 5, "maximum": 600 },
        "co4fe3.autoApprove.terminal": { "type": "boolean", "default": false, "markdownDescription": "Run commands that pass the command policy without asking. Edits are always reviewed." }
      }
    },
    "configurationDefaults": { "diffEditor.codeLens": true }
  },
  "scripts": {
    "build": "node esbuild.mjs && vite build --config webview/vite.config.ts",
    "watch": "node esbuild.mjs --watch"
  }
}
```

## Builds

`esbuild.mjs` (the extension and its e2e tests, CJS, `vscode` external):

```js
import { build, context } from "esbuild";
const base = { bundle: true, platform: "node", format: "cjs", target: "node20", sourcemap: true, external: ["vscode"], logLevel: "info" };
const ext = { ...base, entryPoints: ["src/extension.ts"], outfile: "out/extension.cjs" };
if (process.argv.includes("--watch")) await (await context(ext)).watch();
else {
  await build(ext);
  await build({ ...base, entryPoints: ["test/**/*.test.ts"], outdir: "out/test", external: ["vscode", "mocha"] });
}
```

`webview/vite.config.ts` must produce exactly `media/panel.js` and `media/panel.css`. Check the file names after
the first build, because `panelView.ts` loads those two names.

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: __dirname, plugins: [react()], define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: { outDir: "../media", emptyOutDir: false, cssCodeSplit: false, sourcemap: true,
    rollupOptions: { input: `${__dirname}/src/main.tsx`, output: { format: "iife", entryFileNames: "panel.js", assetFileNames: "panel[extname]" } } },
});
```

`.vscode/launch.json` (repo root):

```json
{ "version": "0.2.0", "configurations": [
  { "name": "Run co4fe3 on flask", "type": "extensionHost", "request": "launch", "preLaunchTask": "npm: build",
    "args": ["--extensionDevelopmentPath=${workspaceFolder}/extensions/co4fe3-vscode", "${workspaceFolder}/.cache/flask"],
    "outFiles": ["${workspaceFolder}/extensions/co4fe3-vscode/out/**/*.cjs"] },
  { "name": "Run co4fe3 on minipkg", "type": "extensionHost", "request": "launch", "preLaunchTask": "npm: build",
    "args": ["--extensionDevelopmentPath=${workspaceFolder}/extensions/co4fe3-vscode", "${workspaceFolder}/test/fixtures/minipkg"],
    "outFiles": ["${workspaceFolder}/extensions/co4fe3-vscode/out/**/*.cjs"] }
] }
```

## Reading text and whole-document ranges (`host/editorHost.ts`, `review/apply.ts`)

```ts
/** The open buffer wins over disk, so the review shows what the user sees. null = the file does not exist. */
export async function currentText(uri: vscode.Uri): Promise<string | null> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  try { return new TextDecoder("utf-8").decode(await vscode.workspace.fs.readFile(uri)); }
  catch (e) { if (e instanceof vscode.FileSystemError && e.code === "FileNotFound") return null; throw e; }
}
export const fullRange = (doc: vscode.TextDocument): vscode.Range => new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
```

Reading with `workspace.fs.readFile` is allowed anywhere in the extension. **Writing is only in `apply.ts`.**

## Diff editor + CodeLens

- Open: `vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title, { preview: false, preserveFocus })`.
  The right side is our `co4fe3-proposal:` content-provider document (workflow 03).
- Lenses: `vscode.languages.registerCodeLensProvider({ scheme: "co4fe3-proposal" }, lens)`. They render inside
  diff editors only with `diffEditor.codeLens: true`, which `configurationDefaults` sets. Verify on day one. If they
  do not show, the title buttons, Alt+Y/N and the panel's diff card still cover per-hunk review.
- Refresh: fire the provider's `onDidChange(uri)` and the lens provider's `onDidChangeCodeLenses`. Never close and
  reopen the editor to refresh.
- Context keys: `setContext("co4fe3.inlineBusy", bool)`, plus `co4fe3.devMode` in Development mode.

## Language features through built-in commands (`host/lsp.ts`, `editorHost.problems`)

Use the public built-in commands, verified on code.visualstudio.com/api/references/commands. This is V3Code's
Context Bridge idea (`lspBridgeAdapter.ts`), done through the extension API instead of workbench services.

| Need | Call | Returns |
|---|---|---|
| symbols in a file | `vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", uri)` | `(SymbolInformation \| DocumentSymbol)[]` |
| definition | `"vscode.executeDefinitionProvider", uri, position` | `(Location \| LocationLink)[]` |
| references | `"vscode.executeReferenceProvider", uri, position` | `Location[]` |
| callers | `"vscode.prepareCallHierarchy", uri, position` → `"vscode.provideIncomingCalls", item` | `CallHierarchyItem[]` → `CallHierarchyIncomingCall[]` |
| hover / signature | `"vscode.executeHoverProvider", uri, position` | `Hover[]` (`contents`: `MarkdownString \| MarkedString`) |
| diagnostics | `vscode.languages.getDiagnostics(uri)` and `vscode.languages.onDidChangeDiagnostics` | `Diagnostic[]` |

Every call resolves to `undefined` or `[]` when no provider is installed, which is normal (no Python extension). Wrap
each one in a 1.5 s ceiling. Map `Diagnostic` to our `Problem` like this:

```ts
const SEV = ["error", "warning", "info", "hint"] as const;      // vscode.DiagnosticSeverity: Error=0, Warning=1, Information=2, Hint=3
export const problemsOf = (uri: vscode.Uri): Problem[] => vscode.languages.getDiagnostics(uri).map((d) => ({
  code: typeof d.code === "object" ? String(d.code.value) : String(d.code ?? d.source ?? ""),
  severity: SEV[d.severity] ?? "info", message: d.message, line: d.range.start.line,
}));
/** Waits until diagnostics for `uri` change after `since`, or `waitMs` passes. Never rejects. */
export function diagnosticsSettled(uri: vscode.Uri, waitMs: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, waitMs);
    const sub = vscode.languages.onDidChangeDiagnostics((e) => { if (e.uris.some((u) => u.toString() === uri.toString())) done(); });
    function done() { clearTimeout(t); sub.dispose(); resolve(); }
  });
}
```

## Webview

- `retainContextWhenHidden: true` on the view, so the transcript survives tab switches.
- CSP exactly as in workflow 05: `default-src 'none'`, scripts by nonce only, styles and fonts from `cspSource`.
  There is no inline style attribute in the HTML shell.
- Theme through CSS variables only: `var(--vscode-editor-background)`, `--vscode-foreground`,
  `--vscode-editor-font-family`, `--vscode-diffEditor-insertedTextBackground`,
  `--vscode-diffEditor-removedTextBackground`, `--vscode-button-background`, `--vscode-badge-background`,
  `--vscode-focusBorder`. That gives no hard-coded colours, and the view works in light themes too.
- `const vscodeApi = acquireVsCodeApi();` once, in `main.tsx`. Keep the composer draft in
  `vscodeApi.setState({ draft })`.
- Never use `dangerouslySetInnerHTML`. Model text is data.

## ripgrep (VS Code ships one)

```ts
export function rgPath(): string {                                  // in host/commands.ts (the only child_process file)
  const exe = process.platform === "win32" ? "rg.exe" : "rg";
  for (const dir of ["node_modules/@vscode/ripgrep/bin", "node_modules.asar.unpacked/@vscode/ripgrep/bin"]) {
    const p = path.join(vscode.env.appRoot, dir, exe);
    if (fs.existsSync(p)) return p;
  }
  return exe;                                                        // PATH; editorHost.search falls back to scanning the index
}
// args: ["--json", "--max-count", "5", "--max-filesize", "1M", "--max-columns", "300", ...(regex ? [] : ["-F"]), ...(glob ? ["-g", glob] : []), "--", pattern, "."]
// parse JSON lines: m.type === "match" → { path: m.data.path.text, line: m.data.line_number, text: m.data.lines.text.trimEnd() }
```

## Spawning (`host/commands.ts`)

```ts
export function runCapped(cmd: string, cwd: string, timeoutMs: number, maxBytes: number, signal: AbortSignal): Promise<CommandResult> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/(_API_KEY|_TOKEN|_SECRET)$/i.test(k)));
    const child = spawn(cmd, { cwd, shell: true, env, detached: process.platform !== "win32" });
    let out = "", truncated = false, timedOut = false, killed = false;
    const add = (b: Buffer) => { out += b.toString("utf8"); if (out.length > maxBytes) { out = out.slice(0, 2048) + "\n…\n" + out.slice(-(maxBytes - 2100)); truncated = true; } };
    child.stdout.on("data", add); child.stderr.on("data", add);
    const kill = () => { killed = true; try { if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]); else process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    signal.addEventListener("abort", kill, { once: true });
    child.on("close", (code) => { clearTimeout(timer); signal.removeEventListener("abort", kill); resolve({ exitCode: code, output: out, truncated, timedOut, killed, ms: Math.round(performance.now() - t0) }); });
  });
}
```
