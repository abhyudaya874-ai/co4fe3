# CODEMAP

Every planned file, its layer and its exact exports. **This is the source of truth for names.** If a name is not
here, in rule 20 or in a `.d.ts`, it does not exist yet. Add it here in the same commit that creates it.
Status: `planned` until the file exists, then `done`. Keep this file sorted by path.

Layers: **core** = `packages/agent-core/src` (pure, no vscode; V3Code's `common/`). **ext** =
`extensions/co4fe3-vscode/src` (V3Code's `browser/`). **web** = `extensions/co4fe3-vscode/webview/src`.
The "V3Code" column names the idea a file reimplements (`docs/study/v3code.md`). We never copy its code (rule 05).

## core: `packages/agent-core/src`

| File | Exports (exact) | Rule / workflow | V3Code idea |
|---|---|---|---|
| `index.ts` | re-exports everything below except `panel/*` | — | |
| `host.ts` | `interface EditorHost { root; readText(rel); listFiles(limit?); search(q, signal); run(req, signal); problems(rel, o?); lsp; now() }` · `interface LspHost { documentSymbols(rel); references(rel, line, col); incomingCalls(rel, line, col); hover(rel, line, col) }` · `LspSymbol` · `LspLocation` · `LspCall` · `SearchQuery` · `SearchHit` · `CommandRequest { command; timeoutMs; inactivityMs; maxOutputBytes }` · `CommandResult { exitCode; output; truncated; timedOut: "wall_clock" \| "inactivity" \| null; killed; ms }` · `interface Applier { apply(change); undo(checkpointId) }` · `FileChange` · `ApplyResult` | 10 | contextBridge `lspBridgeAdapter` |
| `runtime/modes.ts` | `TOOLS` (12, read-first order) · `ToolName` · `ApprovalKind` · `APPROVAL` · `PLAN_TOOLS` (`["write_plan"]`: only the Plan-mode lead gets them) · `READ_ONLY` (no APPROVAL key, no PLAN_TOOLS; `toolsForMode("plan")` = `READ_ONLY` + `write_plan`) · `Mode = "agent" \| "ask" \| "plan"` · `toolsForMode(mode)` · `Profile = "research" \| "work"` · `toolsForProfile(profile, mode)` · `memberMayCall(profile, mode, tool)` · `parseProfile(brief, mode)` | 50 §1 | `availableTools`, `approvalTypeOfBuiltinToolName`, `isSubagentToolAllowed` |
| `runtime/policy.ts` | `REPEAT_SOFT = 3` · `REPEAT_HARD = 5` · `MISTAKE_LIMIT = 4` · `MAX_TOOL_CALLS = 150` · `CallDecision` · `class TurnPolicy { turnId; before(tool, args); after(failed) }` | 50 §2 | `localAgentRuntime` |
| `forge/client.ts` | `makeClient(baseUrl: string): TrueForge` · `STREAM` · `ONCE` · `health(client, signal?): Promise<{ok:true}\|{ok:false;detail:string}>` · `sessionUrl(base: string, sessionId: string): string` (pattern from spike row 8) | 20, 01 | |
| `forge/turn.ts` | `TfEvent` · `EventIndex` · `PendingCall` · `TurnHooks` · `TurnOutcome` · `runTurn(i): Promise<TurnOutcome>` · `findCall(index, sourceEventId, id)` · `textOf(c: unknown): string` · `allow(p)` · `deny(p, reason)` · `reply(p, content)` | 20 | |
| `forge/events.ts` | `messageText(index, id): string` · `toolNameOf(call, server): string \| null` · `safeJson(s: string \| undefined): unknown` · `briefOf(e: thread.created event): string` | skill trueforge-sdk, 50 | |
| `forge/fromForge.ts` | `fromForge(e: TfEvent, index: EventIndex, ctx: { mode: Mode; serverName? }): PanelEvent[]` · `findToolCall(index, toolCallId)` (the call lives inside the `model.message` that issued it; `tool.response` only carries the id) | 05, 50 §3 | |
| `forge/spec.ts` | `MODE_TAIL: Record<Mode, string>` · `buildSpec(file: AgentSpec, o: { model; editorServer; mode?; instructions?; contextLength?; crew? }): AgentSpec` (sets `enableTools = toolsForMode(mode)`) | 07, 50 §7 | `availableTools` |
| `forge/fallback.ts` | `FailKind` · `Failure` · `classifyFailure(message): Failure` · `retryAfterMs(m): number \| null` · `backoffMs(n, rand?): number` · `AttemptResult { outcome; sideEffects; firstTokenMs }` · `RunOn` · `Note` · `runWithFallback(models, runOn, note, signal, sleep?)` · `class AttemptFailed extends Error { model; failure }` | 70, 08 | |
| `forge/models.ts` | `ServedModel` · `providerOf(fqn)` · `shortName(fqn)` · `resolveModelOrder({ pick, configured, explicit, served, max? }): string[]` (the user's pick first, then the configured pair with a fallback behind it; an explicit `models.order` is used exactly) · `modelRows(served, stats, now, recent): ModelRow[]` | 70 | |
| `forge/attempt.ts` | `AttemptUi { onText(full, threadId); onStatus(s); onEvent?; onPause? }` · `attemptTurn(a: { …; stallMs; idleMs? }, ui, signal, now?): Promise<AttemptResult>` | 08 | `v3codeLlmStreamWatchdog` |
| `forge/messages.ts` | `failureLine(model, f): string` · `allFailedLine(failures): string` · `noteLine(n: Note): string` | 70 | |
| `mcp/http.ts` | `McpHttp { url; token; close() }` · `startMcpHttp(make: () => McpServer, log): Promise<McpHttp>` | 02 | `mcpExpose` (loopback, bearer) |
| `mcp/schemas.ts` | `ProposeEditShape` · `ProposeEdit` (zod) · `type ProposeEdit` · `RunCommandShape` · `RunCommand` · `WritePlanShape` · `WritePlan` (zod) · `type WritePlan { title; summary; body }` · `PackContextShape` · `proposalKey(rel, v): string` | 02 | |
| `mcp/server.ts` | `McpDeps` (incl. optional `onCommand(command): { output(text); done() }` (a running command's live output goes to its card) and optional `onApplied({ key, path, checkpointId, newErrors, accepted, total })`, which the chat's diff card listens to, and optional `onPlan(p: WritePlan): string \| undefined` (shows the plan card; a returned string is the refusal the model reads)) · `ToolResult` · `createEditorMcpServer(d: McpDeps): McpServer` · `mcpServerNameFor(root): string` (`co4fe3-ws-<8 hex>`) · `MAX_RESULT_CHARS = 60_000` | 02 | `boundMcpText` |
| `mcp/commandResult.ts` | `formatCommandResult(r, output): string` (the text `run_command` returns: `exit N · X s`, then the output) · `parseCommandResult(text): { exit; seconds; timedOut; killed; output }` (the chat's command card reads the same text back) | 05 | |
| `review/lines.ts` | `splitLines(s): string[]` · `eolOf(s): "\r\n" \| "\n"` | 30 | |
| `review/hunks.ts` | `Hunk { id; oldStart; oldLines; newLines }` · `toHunks(before, after): Hunk[]` · `applyHunks(before, hunks, take): string` · `previewLines(hunks, include): Map<string, number>` | 30, 03 | |
| `review/edits.ts` | `EditOp { oldString; newString }` · `EditReject` · `MAX_EDIT_CHARS = 12_000` · `Plan` · `planEdit(before, ops, content?): Plan` | 30 | `turboDraftHunkQuality` |
| `review/store.ts` | `Proposal` (incl. `why`, `baseline`) · `Decision` · `class ReviewStore { stage; get; onChange; decide; decideAll; settled; take; dropTurn }` | 30 | |
| `review/checkpoints.ts` | `Checkpoint` · `class CheckpointLog { push; get; last; ofTurn; markUndone; toJSON }` | 03 | `_addToHistory` snapshots |
| `review/verify.ts` | `Problem { code; severity; message; line }` · `problemKey(p)` · `newErrors(baseline, after): Problem[]` · `pickProblems(all, max?)` · `renderProblem(p)` | 30 | `turboDraftVerify`, `turboDraftCompilerTruth` |
| `review/inline.ts` | `InlinePhase` · `canAdvance(from, to): boolean` · `extractFence(s, done)` · `streamingPreview(original, partial)` · `assembleInline(text, start, end, code)` · `buildInlinePrompt(i)` · `selectedLines(sel): { start; end }` (a selection ending at column 0 does not include that line) · `class PhaseBox { constructor(initial, onChange); to(p) }` | 04 | `turboDraftRunState`, Ctrl+K prompt |
| `review/view.ts` | `ProposalEvent` · `proposalEvent(p, o?)` (a staged `Proposal` as a diff card: counts, hunks with two lines of context, verdicts) · `settleProposalEvent(last, { applied?, dropped? })` | 05, 30 | |
| `context/tokens.ts` | `estimateTokens(s): number` | 40 | |
| `context/budget.ts` | `BUDGET = { pack: 6000, packCap: 12000, firstMessage: 12000, inline: 3000, readLines: 400, readLinesCap: 800, searchHits: 50, repoMap: 2500, repoMapCap: 4000, symbolPack: 3000, symbolPackCap: 6000, commandBytes: 16384, retrieveFullMs: 800, retrieveQuickMs: 200 }` · `Timer` · `realTimer` · `withinBudget(full, quick, fallback, o)` | 40 | `retrieveBudget` |
| `context/symbols.ts` | `Sym` · `extractSymbols(path, text): Sym[]` | 40 | |
| `context/rrf.ts` | `Fused { id; score; ranks }` · `rrfMerge(channels, k = 60): Fused[]` | 40 | `semanticIndex/rrf` |
| `context/repomap.ts` | `FileEntry` · `RepoIndex` · `RankQuery { text; mentioned; active?; recent; grepHits? }` · `Channel` · `CHANNELS` · `Ranked { path; score; ranks; why }` · `indexFile(path, text)` · `buildIndex(entries)` · `rankFiles(ix, q, o?)` · `queryTerms(text)` · `stem(w)` · `termMatches(term, token)` · `lexicalScore(f, terms, idf)` · `personalizedPageRank(nodes, edges, seed, o?)` · `rarestTerms(ix, text, n)` · `grepTerms(ix, text, n)` (path-naming terms first) · `LexWeights` · `LEX` | 40, 06 | `retriever` (channels + fusion) |
| `context/pack.ts` | `PackItem` · `ContextPack` (incl. `path: "full" \| "quick" \| "none"`) · `EMPTY_PACK` · `wantsPack(text, attached?)` (small talk such as "hi" or "yes, go ahead" gets no pack) · `assemblePack(ix, ranked, pins, budget)` · `outlineOf(f, max?)` · `renderPack(p)` | 40, 06 | `autoContextService` |
| `context/symbolPack.ts` | `PackTask` · `TASK_CAPS` · `SymbolFacts` · `SymbolPack` · `shapeSymbolPack(f, task, maxTokens)` · `renderSymbolPack(p)` · `extractHoverSignature(contents, cap?)` | 40 | `contextBridgeTools` `pack_context` |
| `context/mentions.ts` | `Pin` · `MAX_FOLDER_FILES = 8` · `parseMentions(text, ix): { pins; folders; folderFiles; unresolved; clean }` (`@path`, `@symbol:Name`, `@folder/` ranks its files first; `@rule:`/`@skill:`/`@workflow:` are left for `instructionMentions`) | 40 | |
| `context/complete.ts` | `MAX_COMPLETIONS = 50` · `matchScore(path, q): number` · `MentionQuery { prefix; files; ix; instructions; open }` · `completeMention(q, max?): CompletionItem[]` (the `@` menu: Open files, Files & folders, Symbols, Rules & skills) · `completeSlash(instructions, prefix, max?)` (workflows, then skills) | 40, 85 | |
| `crew/policy.ts` | `CREW = { perRequest: 3, hardStop: 8 }` · `WatchState` · `emptyWatch()` · `crewWatch(s, e)` · `commandPolicy(cmd)` | 50 §6, 30 | `subagentLifecycle` caps |
| `crew/evidence.ts` | `MemberStatus` · `isTerminal(s)` · `MemberEvidence` · `emptyEvidence()` · `assessMemberOutcome(o)` | 50 §4 | `assessWorkerOutcome` |
| `crew/board.ts` | `BoardEntry` · `class Board { write; read; clear }` | 50 §5 | team board |
| `latency/stats.ts` | `ModelStat` · `emptyStat(fqn)` · `record(s, r, now)` · `percentile(xs, p)` · `orderModels(prefs, stats, now, byLatency)` · `hedgeDelayMs(s)` · `stallMs(s)` · `IDLE_STALL_MS = 45_000` | 60 | stream watchdog |
| `latency/hedge.ts` | `Attempt<T>` · `hedged(a, b, delayMs, outer, timer?)` (uses `Timer` from `context/budget.ts`) | 60 | |
| `latency/marks.ts` | `MarkName` · `class Marks { mark; span; line }` | 60 | |
| `instructions/frontmatter.ts` | `Front` · `parseFrontmatter(src): Front` · `listAttr(a, key)` · `boolAttr(a, key)` | 85 | `skillsService` parser |
| `instructions/load.ts` | `Trigger` · `Instruction` · `InstructionSet` · `INSTRUCTION_FILES` · `FILE_CAP(path)` · `loadInstructions(host)` · `selectInline(set, files, budget?)` · `activeSkills(set, request, files, budget?)` · `renderInstructions(base, sel, skills)` · `renderActiveSkills(skills)` · `globToRegExp(g)` · `expandWorkflow(set, input)` (`/workflow` or `/skill-name`) · `instructionMentions(set, input): { text; loaded }` (`@rule:x` / `@skill:x` / `@workflow:x` bodies go with the message) | 85 | `WORKSPACE_INSTRUCTION_PATHS`, `<skills_index>` |
| `panel/index.ts` | re-exports `panel/events`, `panel/reducer`, `panel/coalesce`, `panel/protocol`, `panel/hub`. **The only agent-core entry the webview may import** (`@co4fe3/agent-core/panel`). Type-only imports from outside `panel/`. | 05 | |
| `panel/events.ts` | `PanelEvent` (`user` carries `attach?`; `pack`, `instructions` and `model` carry `turnId?` so each request keeps its own row; `proposal` carries `applied?{ checkpointId; newErrors; undone? }` and `dropped?`; `plan { id; turnId; title; summary; body; state: "proposed" \| "accepted" \| "rejected" }` is write_plan's card, id = the turn; `usage { turnId; model; inputTokens; outputTokens; cacheReadTokens?; window; breakdown }` is the lead's last model call, for the context ring) · `ContextBreakdown { harness; instructions; messages; skills; toolDefinitions }` · `UiCommand` (incl. `plan { id; verdict: "accept" \| "reject" }` and `openPlan { id }`) · `HunkView { id; oldStart; oldLines; newLines; before?; after?; hidden? }` | 05 | |
| `panel/reducer.ts` | `PanelState` (incl. `usage`: the latest `usage` event, outside `order`, like `board`) · `Row` · `emptyPanel(): PanelState` · `rowId(e): string` · `proposalRowId(key)` · `planRowId(id)` · `applyPanelEvent(s, e): PanelState` · `applyPanelBatch(s, events): PanelState` (09: one reducer pass per batch) · `panelEvents(s): PanelEvent[]` (the snapshot that rebuilds `s`) | 05 | |
| `panel/coalesce.ts` | `coalesce(batch: readonly PanelEvent[]): PanelEvent[]` | 05 | |
| `panel/protocol.ts` | the frame around the transcript: `LayoutId` · `UiMode` · `UI_MODES` · `runtimeOf(ui)` · `uiModeOf(mode, auto)` · `nextUiMode(ui)` · `SelectionRef` · `selectionLabel(s)` · `ChromeState` · `emptyChrome()` · `SessionSummary` · `ForgeRef` · `ModelRow` · `HostMessage` (`completions { kind; prefix; items: CompletionItem[] }`) · `CompletionItem { kind: file\|folder\|symbol\|rule\|skill\|workflow; label; detail; insert; group }` · `PersistedSession` · `sessionTitle(text)` · `relativeAge(then, now)` · `parseUiCommand(raw): UiCommand \| null` (the webview is untrusted input) · `compactEvents(events)` · `restoreEvents(events)` | 05 | |
| `panel/hub.ts` | `class Hub { attach(port); hello(port); push(e); flush(); panel; proposal(key); chrome; setChrome(patch); broadcast(m); activeId; forge; summaries(); persistNow(); newSession(); switchTo(id); remove(id); dispose() }` · `HubPort` · `HubStore` · `HubDeps`. The single source of truth for what the Agent window and the dock show: it reduces events, batches them per webview, replays a snapshot on `ready` and owns the session list. No `vscode` import | 05 | |
| `util/stable.ts` | `stableStringify(v): string` · `sha256Hex(s): string` | 02 | |
| `util/jail.ts` | `class ToolInputError extends Error` · `jail(root, p): string` | 30 | |
| `util/truncate.ts` | `truncateWithHint(text, max, hint): string` | 40 | "TRUNCATED … re-run …" |
| `util/redact.ts` | `redact(s): string` (keys, bearer tokens, `Authorization:` values) | 70 | |
| `util/queue.ts` | `class KeyedQueue { run<T>(key, fn: () => Promise<T>): Promise<T> }` | 30 | |
| `util/abort.ts` | `realSleep(ms, signal?): Promise<void>` | 70 | |

## ext: `extensions/co4fe3-vscode/src`

| File | Exports | Rule / workflow |
|---|---|---|
| `extension.ts` | `activate(ctx)` · `deactivate(): Promise<void>` (restores the layout and writes the session; wiring only, < 150 ms) | 10 |
| `config.ts` | `Config` (incl. `models.explicit`, `agentMode.hideChrome`) · `readConfig(): Config` (every `co4fe3.*` setting, typed) | — |
| `status.ts` | `class StatusItems { trueforge; model; mode; ttft; undo; layout }` · `setLayout("agent" \| "editor")` | 02, 60 |
| `host/editorHost.ts` | `createEditorHost(ctx, out): EditorHost` · `currentText(uri)` · `fullRange(doc)` · `problemsOf(uri)` (maps `vscode.languages.getDiagnostics`) | 10, 30 |
| `host/lsp.ts` | `createLspHost(root): LspHost` (built-in commands: `vscode.executeDocumentSymbolProvider`, `executeReferenceProvider`, `prepareCallHierarchy` + `provideIncomingCalls`, `executeHoverProvider`) | 40 |
| `host/commands.ts` | `runCapped(cmd, cwd, timeoutMs, inactivityMs, maxBytes, signal)` · `rgPath()` · `rgSearch(root, q, signal)` (**the only `child_process` file**) | skill vscode-extension |
| `review/apply.ts` | `createApplier(root, log, onChange): Applier & { last(); ofTurn(turnId) }` · `applyDecision(applier, p, d)` (**the only writer**) | 30 |
| `review/proposalDocs.ts` | `SCHEME = "co4fe3-proposal"` · `proposalUri(rel, key, side?)` · `class ProposalDocs` | 03 |
| `panel/planDocs.ts` | `PLAN_SCHEME = "co4fe3-plan"` · `planUri(id)` (`/plan-<id>.md`, read-only virtual doc: plans never touch the workspace, law 3) · `planMarkdown(p)` · `findPlan(hub, id)` · `implementPlanMessage(p)` (what Accept sends to the Code-mode turn) · `registerPlanDocs(hub): Disposable` | 05 |
| `review/hunkLens.ts` | `class HunkLens` | 03 |
| `review/controller.ts` | `interface ReviewController { store; review(p, signal, o?: { focus?; open? }); showStreaming(rel, key, before); preview(rel, key, text); closeStreaming(key, message?); closeTurn(turnId); close(key); show(key); openPending(); reveal(rel, line) }` · `createReviewController(ctx, deps)`. `open: false` stages without opening a diff tab (the chat's diff card is the review) | 03, 04 |
| `inline/inlineEdit.ts` | `registerInlineEdit(ctx, d)` (one pipeline, two surfaces: the comment widget for Ctrl+Alt+K, the diff tab for `co4fe3.inlineEdit { instruction }`) · `targetLines(ed, ix): { start; end }` | 04 |
| `inline/inlineThread.ts` | `CONTROLLER_ID = "co4fe3-inline"` · `class InlineWidget { open(ed, start, end); disarm(); setPlaceholder() }` (VS Code's native comment box over the selected lines) · `class ThreadView { label; preview; show(p); update(p); hunkOf(comment) }` · `fenced(lang, body)` · `diffText(h)` | 04 |
| `panel/panelView.ts` | `webviewHtml(webview, extensionUri, surface)` (strict CSP, nonce) · `Surface = "agent" \| "dock"` · `CommandHandler` · `class DockView implements WebviewViewProvider` (`DockView.id = "co4fe3.dock"`, `DockView.legacyId = "co4fe3.panel"`) · `class AgentWindow { open(); close(); isOpen; onUserClosed }` (a full-window webview panel) | 05 |
| `panel/agentTurn.ts` | `class AgentTurns { send(text, attach?, shown?); stop(); busy }` (`AgentTurnDeps.contextWindow(model)` sizes the context ring) (`shown`: the user bubble's text when the model gets more, e.g. an accepted plan). One TrueForge session per conversation (`SessionPool.chat`); Stop keeps the turn "running" until it has unwound (8 s watchdog) | 05 |
| `panel/uiCommands.ts` | `createUiCommands(d: UiCommandDeps): CommandHandler` (`UiCommandDeps.files()`: every workspace file, cached; `openPaths()`: active, visible, then edited files) (every `UiCommand` the webview can send, one case each) · `pickModelQuick(d)` (the status-bar model menu) | 05 |
| `panel/sessionStore.ts` | `class FileSessionStore implements HubStore { list; load; put; remove; settled }` (JSON files under the extension's own storage folder, never the workspace) · `isSessionId(id)` | 05 |
| `layout/layoutController.ts` | `class LayoutController { layout; enter(l); toggle(); recover(); leave() }` · `LayoutHooks`. Agent mode hides the activity bar, status bar, tabs and layout buttons through four user settings, backs them up first, and restores them exactly on exit, on tab close, on deactivate and (if the window died) on the next start | 05 |
| `panel/pause.ts` | `PauseDeps { host; review; crew; serverName; mode; turnKey; sideEffect; cfg }` · `makeOnPause(d): TurnHooks["onPause"]` (one review per file; profile gate; evidence) · `jailedPathArg(root, call): string \| null` | 05, 30, 50 |
| `panel/crew.ts` | `class Crew { constructor(mode, push); onEvent(e); member(threadId); setStatus(threadId, status); record(threadId, add); finish(threadId, report, failed); cancelAll(): PanelEvent[] }` (imports `briefOf` from core `forge/events.ts`) | 07, 50 §4 |
| `context/indexer.ts` | `class IndexStore { get(); ready(); set(ix); update(entry); remove(path) }` · `class ContextPacks { packFor(text, active?, recent?): Promise<ContextPack> }` (uses `withinBudget`) · `indexWorkspaceInBackground(host, store, out)` | 06, 40 |
| `forge/sessions.ts` | `SpecFor` · `ChatWant { project; instr; mode; model; title? }` (`title` names a new TrueForge session: `UpdateSessionRequest.title`) · `class SessionPool { warm(mode, model); take(mode, model); chat(prev, want): Promise<ForgeRef> }` (reuses the conversation's session, updates its spec when the mode, model or project rules changed, verifies a restored id with `sessions.get`) · `registerEditorServer(client, name, mcp, status)` | 02, 08 |
| `forge/router.ts` | `InlineResult` · `class Router { order(mode); inline(prompt, ui, signal); agent(session, text, hooks & { specFor(model) }, signal); label(mode); lastModel(); currentModel(); benched(fqn); stat(fqn); statsMap(); resetStats() }` | 08, 09 |
| `forge/catalog.ts` | `class ModelCatalog { served; pick; recent; order(); setPick(name \| null); noteAnswered(model); refresh(); discover(); dispose() }` (what TrueForge serves, the user's pick and the recents live in `globalState`, never a settings file; `discover()` retries until TrueForge answers) | 70 |

## web: `extensions/co4fe3-vscode/webview/src`
One React app, two shapes. The host page sets `<body data-surface="agent|dock">`: `agent` is the full-window view
(sessions sidebar, centred column), `dock` is the narrow chat beside the editor. Imports only
`@co4fe3/agent-core/panel`.
- `main.tsx` (mounts the app inside an `ErrorBoundary`; owns `acquireVsCodeApi()`) · `main.css` (theme variables,
  three depth steps, container query for the narrow composer) · `vite-env.d.ts` (CSS imports typecheck under TS 7).
- `App.tsx` (state: transcript, chrome, sessions, models; stick-to-bottom scrolling and the jump button; both layouts)
  · `actions.tsx` (`Actions` context: what a row can ask the host to do, incl. `plan(id, verdict)` and `openPlan(id)`) · `format.ts` (pure: `toolLabel`,
  `hunkLines`, `hunkDeltas`, `pendingReview`, `speedBars`, `modelSections`, `fileRef`, `fileLink`, `splitPath`) · `md.tsx`
  (markdown for model text, React elements only: headings, paragraphs with hard breaks, bold, italic, strike, code,
  safe links, fenced code with a Copy button, bullet, numbered and task lists (nested), quotes, rules and GFM tables;
  a file written in code or linked becomes an "open" button) · `highlight.tsx` (`highlight(code, lang)`: comments,
  strings, numbers, keywords and calls for common languages, and diffs).
- `components/`: `Transcript` (per-row error boundaries, run status) · `rows` (`UserBubble`, `AssistantText` with
  "Thoughts", `ToolRow`, `MemberRow`, `MessageBubble`, `PackCard`, `BoardCard`, `CommandCard`, `ModelBanner`,
  `Marker`, `LatencyLine`, `InstructionsLine`) · `DiffCard` (red/green lines with numbers, per-change Accept and
  Reject, applied / undone / dropped footers) · `PlanCard` (`plan-<id>.md`, title, summary, steps; Open, Reject and
  Accept, disabled while the turn runs; Accept switches to Code and sends the plan) · `ContextMeter` (Devin's ring: % of the window
  the lead's last call used, with the breakdown, the prompt cache and the pack; `kTokens(n)`) · `Composer` (`tokenAt(text, caret)`) (growing input, selection chip, `@` and `/`
  completions) · `ReviewBar` (files, totals, Accept all / Reject all above the composer while edits wait) · `menus` (`ModeMenu`: Code, Ask, Plan, Bypass Permissions; `ModelMenu`: search, Fastest, Recently
  used, All, hover details) · `Sidebar` (`LayoutPill`, session list with ages) · `Empty` · `Icon` (inline SVG) ·
  `ErrorBoundary`.
- `webview/test/`: `format.test.ts`, `md.test.tsx`, `render.test.tsx` (renders every `PanelEvent` kind, typed so a new kind needs a fixture).
## The 12 MCP tools (`mcp/server.ts`, registered in this read-first order; the coder agent preloads them all)

`repo_map{query, budget_tokens=2500}` · `search_workspace{pattern, regex=false, glob?}` · `find_symbol{name}` ·
`pack_context{path, symbol, task="understand"|"refactor"|"debug"|"extend", max_tokens=3000}` ·
`read_file{path, offset=1, limit=400}` · `list_changes{}` · `board_read{key?}` · `board_write{key, value, by}` ·
`load_instructions{kind: "rule"|"skill"|"file", name}` ·
`write_plan{title, summary, body}` **Plan mode only** (`PLAN_TOOLS`; shows the plan card, refuses outside Plan mode through `McpDeps.onPlan`) ·
`propose_edit{path, why, edits?[{old_string,new_string}], content?}` **gated (edits)** ·
`run_command{command, timeout_s=120}` **gated (terminal)**.

`check-invariants.mjs` compares this section with `runtime/modes.ts` `TOOLS` and with `mcp/server.ts`.

## Commands, keybindings and settings
The full list is in `extensions/co4fe3-vscode/package.json`. The ids:
- layouts: `co4fe3.agentMode`, `co4fe3.editorMode`, `co4fe3.toggleLayout` (Ctrl/Cmd+Alt+J), `co4fe3.focusChat`;
- sessions: `co4fe3.newSession`, `co4fe3.sessionHistory`, `co4fe3.openSession`;
- inline edit and review: `co4fe3.inlineEdit` (Ctrl/Cmd+Alt+K), `co4fe3.inlineCancel` (Esc while busy),
  `co4fe3.inline.submit|model|hunkAccept|hunkReject|acceptAll|rejectAll|close` (the buttons of the in-editor widget),
  `co4fe3.hunk.accept|reject`, `co4fe3.hunk.acceptAtCursor|rejectAtCursor` (Alt+Y/Alt+N),
  `co4fe3.proposal.acceptAll|rejectAll`;
- undo: `co4fe3.undoLast`, `co4fe3.revertTurn`;
- modes: `co4fe3.cycleMode` (Ctrl/Cmd+. while the chat has focus; cycles Code, Ask, Plan, Bypass Permissions);
- models and TrueForge: `co4fe3.pickModel`, `co4fe3.resetStats`, `co4fe3.startTrueForge`;
- development mode only: `co4fe3.dev.sampleProposal`, `co4fe3.dev.rank`.
Views: `co4fe3.dock` (secondary sidebar, VS Code 1.106+) and `co4fe3.panel` (activity bar, older hosts; chosen by the
context key `co4fe3.legacyDock`). The Agent window is a webview panel with id `co4fe3.agent`.
Settings: `co4fe3.trueforge.url`, `co4fe3.trueforge.command`, `co4fe3.models.order` (default
`nvidia-nim/nemotron-super`, `google-gemini/gemini-flash-lite`; left at its default it is padded with other served
models), `co4fe3.mode` (`agent`|`ask`|`plan`; the starting mode, the chat remembers the last choice),
`co4fe3.crew.enabled`, `co4fe3.context.packTokens`, `co4fe3.latency.autoOrderInline`, `co4fe3.latency.hedgeInline`,
`co4fe3.commands.timeoutSeconds`, `co4fe3.autoApprove.terminal`, `co4fe3.agentMode.hideChrome`, `co4fe3.editor.openDiffs` (Editor mode opens a proposed edit as a diff at once). Contributed defaults:
`diffEditor.codeLens: true`, `comments.openView: "never"`. Context keys: `co4fe3.inlineBusy`, `co4fe3.devMode`,
`co4fe3.agentMode`, `co4fe3.legacyDock`. State (never a settings file): `globalState["co4fe3.stats.v1"]`,
`["co4fe3.uiMode"]`, `["co4fe3.model.pick"]`, `["co4fe3.model.recent"]`, `["co4fe3.layout.backup.v1"]`,
`["co4fe3.dockShown"]`; checkpoints in `storageUri/checkpoints.json`; sessions in `storageUri/sessions/*.json`.
## Scripts and data

`scripts/verify.mjs` · `check-invariants.mjs` · `setup-trueforge.mjs` · `bench-latency.mjs` · `smoke-live.mjs` ·
`save-agents.mjs` · `spike.mjs` (throwaway, workflow 01) · `hooks/*.sh` · `hooks/test-hooks.sh`.
`agents/co4fe3-coder.agent.json` and `agents/co4fe3-inline.agent.json` (placeholders `$MODEL` and `$EDITOR`) ·
`config/providers.example.json` · `NOTICE`.

## Tests

- `packages/agent-core/test/`:
  - runtime: `modes`, `policy`;
  - review: `hunks`, `edits`, `verify`, `store`, `checkpoints`, `jail`, `inline`;
  - context: `tokens`, `symbols`, `rrf`, `repomap`, `budget`, `pack`, `symbolPack`, `mentions`, `truncate`;
  - crew: `evidence`, `crewpolicy`, `board`;
  - forge: `fallback`, `attempt`, `fromForge`, `spec`, `turn`;
  - latency: `stats`, `hedge`, `marks`;
  - panel and the rest: `reducer`, `coalesce`, `protocol`, `hub`, `view`, `models`, `commandResult`, `frontmatter`, `instructions`, `mcp-tools`, `redact`;
  - perf: `perf/*.perf.test.ts` and `perf/synth.ts`.
- `test/integration/`: `global-setup.ts`, `harness.ts`, `roundtrip`, `mcp`, `approval`, `cancel`, `crew`,
  `fallback`, `overhead`.
- `test/fakes/fake-openai.ts`.
- `extensions/co4fe3-vscode/webview/test/`: `format.test.ts`, `render.test.tsx` (vitest project `webview`, in `verify`).
- `extensions/co4fe3-vscode/test/`: `activation.test.ts`, `inline.test.ts`, `pause.test.ts` (one review per file,
  profile gate; it runs in the extension host because `pause.ts` is extension code).
