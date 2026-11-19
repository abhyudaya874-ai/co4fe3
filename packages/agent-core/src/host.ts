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
  /** Runs one shell command in `root`. Killed when `signal` aborts, or on a wall-clock / inactivity timeout. Output capped. */
  run(req: CommandRequest, signal: AbortSignal): Promise<CommandResult>;
  /** Language-server problems for one file (rule 30, verify). With `waitMs`, waits that long for a diagnostics change after `changedSince`. [] when no server. */
  problems(rel: string, o?: { changedSince?: number; waitMs?: number }): Promise<Problem[]>;
  /** Language features through VS Code's built-in commands (rule 40, pack_context). Every method resolves [] / null when no provider answers. */
  readonly lsp: LspHost;
  now(): number;
}
export interface SearchQuery { pattern: string; regex?: boolean; glob?: string; maxHits?: number }
export interface SearchHit { path: string; line: number; text: string }
export interface CommandRequest { command: string; timeoutMs: number; inactivityMs: number; maxOutputBytes: number }
export interface CommandResult { exitCode: number | null; output: string; truncated: boolean; timedOut: "wall_clock" | "inactivity" | null; killed: boolean; ms: number }
export interface Problem { code: string; severity: "error" | "warning" | "info" | "hint"; message: string; line: number }

/** Positions are 0-based. `rel` is workspace-relative and already jailed. Extension side: host/lsp.ts. */
export interface LspHost {
  documentSymbols(rel: string): Promise<LspSymbol[]>;                          // vscode.executeDocumentSymbolProvider (flattened, with parent names)
  references(rel: string, line: number, col: number): Promise<LspLocation[]>;  // vscode.executeReferenceProvider
  incomingCalls(rel: string, line: number, col: number): Promise<LspCall[]>;   // vscode.prepareCallHierarchy → vscode.provideIncomingCalls
  hover(rel: string, line: number, col: number): Promise<string[]>;            // vscode.executeHoverProvider → markdown strings
}
export interface LspSymbol { name: string; kind: string; line: number; endLine: number; col: number; parent?: string }
export interface LspLocation { path: string; line: number }                     // path: workspace-relative; outside-root hits are dropped
export interface LspCall { from: string; path: string; line: number }           // `from` = the calling function's name

/** The ONLY way bytes reach disk. Implemented in extensions/…/review/apply.ts. */
export interface Applier {
  /** Writes `after` iff the file still holds `before` (null = must not exist). All or nothing. Records a checkpoint. */
  apply(change: FileChange): Promise<ApplyResult>;
  /** Restores the checkpoint's `before` bytes iff the file still holds its `after`. */
  undo(checkpointId: string): Promise<ApplyResult>;
}
export interface FileChange { path: string; before: string | null; after: string; turnId: string; reason: string }
export type ApplyResult = { ok: true; checkpointId: string } | { ok: false; why: "conflict" | "outside_root" | "io"; detail: string };
