---
trigger: always_on
description: Layers, package boundaries, the injected host interfaces, the single write path, and where every kind of code goes
---

# Architecture

## Layers (imports point down only)

```
extensions/co4fe3-vscode/webview   React UI. Imports ONLY @co4fe3/agent-core/panel (pure reducer + types).
        │ postMessage (PanelEvent batches down, UiCommand up)
extensions/co4fe3-vscode/src       VS Code glue. Implements EditorHost + Applier. Owns the diff editor, CodeLens, webview.
        │ calls
packages/agent-core/src            The brain. Pure TypeScript. NO `vscode`, NO `child_process`, NO `fs` writes.
        │ HTTP (SDK)                          ▲ HTTP (MCP, bearer token, 127.0.0.1 only)
TrueForge (npx, localhost:8790) ──────────────┘   TrueForge calls our MCP server; we never call a provider.
```

`packages/agent-core` is the same code the Code-OSS app will use after Round 1. Keep its API stable, and keep every
export listed in `docs/CODEMAP.md`.

## Repository layout (create exactly this; add files only through CODEMAP.md)

```
co4fe3/
├── package.json                    npm workspaces: ["packages/*", "extensions/*"]
├── tsconfig.base.json              strict, ES2022, moduleResolution "bundler", noUncheckedIndexedAccess
├── vitest.config.ts                projects: unit (packages/**/test), integration (test/integration)
├── agents/                         co4fe3-coder.agent.json, co4fe3-inline.agent.json  (TrueForge AgentSpec)
├── config/providers.example.json   model providers for TrueForge (no keys)
├── scripts/                        verify.mjs, check-invariants.mjs, setup-trueforge.mjs, bench-latency.mjs, hooks/
├── packages/agent-core/
│   ├── src/
│   │   ├── host.ts                 EditorHost, Applier, CommandRequest, SearchHit (interfaces only)
│   │   ├── forge/                  client.ts, spec.ts, turn.ts, events.ts, fallback.ts
│   │   ├── mcp/                    server.ts (tools), http.ts (transport + auth), schemas.ts
│   │   ├── review/                 lines.ts, hunks.ts, edits.ts, store.ts, checkpoints.ts
│   │   ├── context/                tokens.ts, symbols.ts, repomap.ts, pack.ts, mentions.ts
│   │   ├── crew/                   roles.ts, policy.ts, board.ts
│   │   ├── latency/                stats.ts, marks.ts
│   │   ├── instructions/           frontmatter.ts, load.ts
│   │   ├── panel/                  events.ts (PanelEvent), reducer.ts (applyPanelEvent), coalesce.ts
│   │   └── util/                   redact.ts, stable.ts (stableStringify, sha256Hex), abort.ts
│   └── test/                       *.test.ts (unit, no network, no vscode)
├── extensions/co4fe3-vscode/
│   ├── package.json                contributes: commands, keybindings, views, configuration, configurationDefaults
│   ├── src/
│   │   ├── extension.ts            activate(): wires everything, nothing else
│   │   ├── host/                   editorHost.ts (EditorHost impl), commands.ts (the ONLY child_process use)
│   │   ├── review/                 apply.ts (the ONLY writer), proposalDocs.ts, hunkLens.ts, controller.ts
│   │   ├── inline/                 inlineEdit.ts (Task A)
│   │   ├── panel/                  panelView.ts (WebviewViewProvider), bridge.ts (batching)
│   │   └── forge/                  sessions.ts (pool + prewarm), router.ts (model order + fallback + stats)
│   ├── webview/                    Vite + React: main.tsx, App.tsx, components/*
│   └── test/                       @vscode/test-cli smoke tests
└── test/
    ├── fakes/                      fake-openai.ts (scripted OpenAI-compatible model server)
    ├── fixtures/minipkg/           small offline Python package that mimics flask's layout (our own code)
    └── integration/                real TrueForge + fake model + real MCP server
```

## The two injected interfaces (copy exactly; `packages/agent-core/src/host.ts`)

```ts
/** Everything agent-core may ask of the editor. Read-only, except `run`. Implemented in extensions/…/host/editorHost.ts. */
export interface EditorHost {
  /** Absolute, realpath-resolved workspace folder. Every relative path is resolved against it and must stay inside it. */
  readonly root: string;
  /** Current text: the open editor buffer if the file is open, else disk. `null` when the file does not exist. */
  readText(rel: string): Promise<string | null>;
  /** Workspace-relative paths, honouring .gitignore and files.exclude. Capped at `limit` (default 5000). */
  listFiles(limit?: number): Promise<string[]>;
  /** ripgrep. Literal by default; `regex: true` opts in. Never throws on "no matches": returns []. */
  search(q: SearchQuery, signal: AbortSignal): Promise<SearchHit[]>;
  /** Runs one shell command in `root`. Killed when `signal` aborts or `timeoutMs` passes. Output capped. */
  run(req: CommandRequest, signal: AbortSignal): Promise<CommandResult>;
  now(): number;
}
export interface SearchQuery { pattern: string; regex?: boolean; glob?: string; maxHits?: number }
export interface SearchHit { path: string; line: number; text: string }
export interface CommandRequest { command: string; timeoutMs: number; maxOutputBytes: number }
export interface CommandResult { exitCode: number | null; output: string; truncated: boolean; timedOut: boolean; killed: boolean; ms: number }

/** The ONLY way bytes reach disk. Implemented in extensions/…/review/apply.ts. */
export interface Applier {
  /** Writes `after` iff the file still holds `before` (null = must not exist). All or nothing. Records a checkpoint. */
  apply(change: FileChange): Promise<ApplyResult>;
  /** Restores the checkpoint's `before` bytes iff the file still holds its `after`. */
  undo(checkpointId: string): Promise<ApplyResult>;
}
export interface FileChange { path: string; before: string | null; after: string; turnId: string; reason: string }
export type ApplyResult = { ok: true; checkpointId: string } | { ok: false; why: "conflict" | "outside_root" | "io"; detail: string };
```

## Activation sequence (`extension.ts` does this and nothing else)

```ts
export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const out = vscode.window.createOutputChannel("co4fe3", { log: true });
  const cfg = readConfig();                                   // co4fe3.* settings, typed
  const host = createEditorHost(ctx, out);                    // host/editorHost.ts
  const applier = createApplier(ctx, out);                    // review/apply.ts  (the only writer)
  const review = createReviewController(ctx, applier);        // diff editor + CodeLens + decisions
  const client = makeClient(cfg.trueforgeUrl);                // agent-core/forge/client.ts
  const mcp = await startMcpHttp({ host, applier, review: review.store, out }); // 127.0.0.1:<port>, random token
  ctx.subscriptions.push({ dispose: () => void mcp.close() });
  const serverName = mcpServerNameFor(host.root);             // "co4fe3-ws-<8 hex>"
  void registerEditorServer(client, serverName, mcp).catch((e) => out.error(String(e))); // never blocks activation
  const router = createRouter(ctx, client, cfg);              // model order, fallback, latency stats
  const sessions = createSessionPool(client, router, serverName); // pre-warmed sessions
  registerInlineEdit(ctx, { host, review, sessions, router, out });
  registerPanel(ctx, { host, review, sessions, router, client, out });
  void indexWorkspaceInBackground(host, out);                 // repo map; chunked, never blocks
}
```

Activation must finish in **< 150 ms**. Rule 60 has the budget. Anything slow is `void`-started, never `await`ed in
`activate`.

## Where does X go?

| You are writing… | It goes in | Never in |
|---|---|---|
| A pure decision (hunks, ranking, fallback order, crew policy) | `packages/agent-core/src/**` with a unit test | the extension |
| Anything that touches `vscode.*` | `extensions/co4fe3-vscode/src/**` | agent-core |
| A file write | `review/apply.ts` (through `Applier`) | anywhere else; check-invariants fails |
| Spawning a process | `host/commands.ts` | anywhere else |
| A TrueForge call | `agent-core/src/forge/*` | the webview, the MCP handlers |
| UI state | `agent-core/src/panel/reducer.ts` (pure) | React component state, except ephemeral input |
| A new setting | `package.json` `contributes.configuration` + `readConfig()` + `docs/CODEMAP.md` | hard-coded constants |
| A model name | TrueForge config and `config/providers.example.json` | any `.ts` file |

## Boundaries the checker enforces (`scripts/check-invariants.mjs`)

1. `packages/agent-core/**` has no `from "vscode"`, no `child_process`, no `writeFile`, `appendFile`, `rm` or `unlink`.
2. Only `extensions/co4fe3-vscode/src/review/apply.ts` calls `workspace.applyEdit`, `workspace.fs.writeFile`,
   `workspace.fs.delete` or `TextDocument.save`.
3. Only `extensions/co4fe3-vscode/src/host/commands.ts` imports `child_process`.
4. No provider hostnames and no provider SDK packages in `packages/` or `extensions/`.
5. `webview/**` imports from agent-core only through `@co4fe3/agent-core/panel`.
6. Every MCP tool registered in `mcp/server.ts` is listed in `agents/*.agent.json` (`enableTools`), and the gated ones
   are listed in `requireApprovalForTools`.
