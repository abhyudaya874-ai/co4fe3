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
| `runtime/modes.ts` | `TOOLS` (11, read-first order) · `ToolName` · `ApprovalKind` · `APPROVAL` · `READ_ONLY` · `Mode = "agent" \| "ask" \| "plan"` · `toolsForMode(mode)` · `Profile = "research" \| "work"` · `toolsForProfile(profile, mode)` · `memberMayCall(profile, mode, tool)` · `parseProfile(brief, mode)` | 50 §1 | `availableTools`, `approvalTypeOfBuiltinToolName`, `isSubagentToolAllowed` |
| `runtime/policy.ts` | `REPEAT_SOFT = 3` · `REPEAT_HARD = 5` · `MISTAKE_LIMIT = 4` · `MAX_TOOL_CALLS = 150` · `CallDecision` · `class TurnPolicy { turnId; before(tool, args); after(failed) }` | 50 §2 | `localAgentRuntime` |
| `forge/client.ts` | `makeClient(baseUrl: string): TrueForge` · `STREAM` · `ONCE` · `health(client, signal?): Promise<{ok:true}\|{ok:false;detail:string}>` · `sessionUrl(base: string, sessionId: string): string` (pattern from spike row 8) | 20, 01 | |
| `forge/turn.ts` | `TfEvent` · `EventIndex` · `PendingCall` · `TurnHooks` · `TurnOutcome` · `runTurn(i): Promise<TurnOutcome>` · `findCall(index, sourceEventId, id)` · `textOf(c: unknown): string` · `allow(p)` · `deny(p, reason)` · `reply(p, content)` | 20 | |
| `forge/events.ts` | `messageText(index, id): string` · `toolNameOf(call, server): string \| null` · `safeJson(s: string \| undefined): unknown` · `briefOf(e: thread.created event): string` | skill trueforge-sdk, 50 | |
| `forge/fromForge.ts` | `fromForge(e: TfEvent, index: EventIndex, ctx: { mode: Mode }): PanelEvent[]` | 05, 50 §3 | |
| `forge/spec.ts` | `MODE_TAIL: Record<Mode, string>` · `buildSpec(file: AgentSpec, o: { model; editorServer; mode?; instructions?; contextLength?; crew? }): AgentSpec` (sets `enableTools = toolsForMode(mode)`) | 07, 50 §7 | `availableTools` |
| `forge/fallback.ts` | `FailKind` · `Failure` · `classifyFailure(message): Failure` · `retryAfterMs(m): number \| null` · `backoffMs(n, rand?): number` · `AttemptResult { outcome; sideEffects; firstTokenMs }` · `RunOn` · `Note` · `runWithFallback(models, runOn, note, signal, sleep?)` · `class AttemptFailed extends Error { model; failure }` | 70, 08 | |
| `forge/attempt.ts` | `AttemptUi { onText(full, threadId); onStatus(s); onEvent?; onPause? }` · `attemptTurn(a: { …; stallMs; idleMs? }, ui, signal, now?): Promise<AttemptResult>` | 08 | `v3codeLlmStreamWatchdog` |
| `forge/messages.ts` | `failureLine(model, f): string` · `allFailedLine(failures): string` · `noteLine(n: Note): string` | 70 | |
| `mcp/http.ts` | `McpHttp { url; token; close() }` · `startMcpHttp(make: () => McpServer, log): Promise<McpHttp>` | 02 | `mcpExpose` (loopback, bearer) |
| `mcp/schemas.ts` | `ProposeEditShape` · `ProposeEdit` (zod) · `type ProposeEdit` · `RunCommandShape` · `RunCommand` · `PackContextShape` · `proposalKey(rel, v): string` | 02 | |
| `mcp/server.ts` | `McpDeps` · `ToolResult` · `createEditorMcpServer(d: McpDeps): McpServer` · `mcpServerNameFor(root): string` (`co4fe3-ws-<8 hex>`) · `MAX_RESULT_CHARS = 60_000` | 02 | `boundMcpText` |
| `review/lines.ts` | `splitLines(s): string[]` · `eolOf(s): "\r\n" \| "\n"` | 30 | |
| `review/hunks.ts` | `Hunk { id; oldStart; oldLines; newLines }` · `toHunks(before, after): Hunk[]` · `applyHunks(before, hunks, take): string` · `previewLines(hunks, include): Map<string, number>` | 30, 03 | |
| `review/edits.ts` | `EditOp { oldString; newString }` · `EditReject` · `MAX_EDIT_CHARS = 12_000` · `Plan` · `planEdit(before, ops, content?): Plan` | 30 | `turboDraftHunkQuality` |
| `review/store.ts` | `Proposal` (incl. `why`, `baseline`) · `Decision` · `class ReviewStore { stage; get; onChange; decide; decideAll; settled; take; dropTurn }` | 30 | |
| `review/checkpoints.ts` | `Checkpoint` · `class CheckpointLog { push; get; last; ofTurn; markUndone; toJSON }` | 03 | `_addToHistory` snapshots |
| `review/verify.ts` | `Problem { code; severity; message; line }` · `problemKey(p)` · `newErrors(baseline, after): Problem[]` · `pickProblems(all, max?)` · `renderProblem(p)` | 30 | `turboDraftVerify`, `turboDraftCompilerTruth` |
| `review/inline.ts` | `InlinePhase` · `canAdvance(from, to): boolean` · `extractFence(s, done)` · `streamingPreview(original, partial)` · `assembleInline(text, start, end, code)` · `buildInlinePrompt(i)` | 04 | `turboDraftRunState`, Ctrl+K prompt |
| `context/tokens.ts` | `estimateTokens(s): number` | 40 | |
| `context/budget.ts` | `BUDGET = { pack: 6000, packCap: 12000, firstMessage: 12000, inline: 3000, readLines: 400, readLinesCap: 800, searchHits: 50, repoMap: 2500, repoMapCap: 4000, symbolPack: 3000, symbolPackCap: 6000, commandBytes: 16384, retrieveFullMs: 800, retrieveQuickMs: 200 }` · `Timer` · `realTimer` · `withinBudget(full, quick, fallback, o)` | 40 | `retrieveBudget` |
| `context/symbols.ts` | `Sym` · `extractSymbols(path, text): Sym[]` | 40 | |
| `context/rrf.ts` | `Fused { id; score; ranks }` · `rrfMerge(channels, k = 60): Fused[]` | 40 | `semanticIndex/rrf` |
| `context/repomap.ts` | `FileEntry` · `RepoIndex` · `RankQuery { text; mentioned; active?; recent; grepHits? }` · `Channel` · `CHANNELS` · `Ranked { path; score; ranks; why }` · `indexFile(path, text)` · `buildIndex(entries)` · `rankFiles(ix, q)` · `queryTerms(text)` · `stem(w)` · `termMatches(term, token)` · `lexicalScore(f, terms, idf)` · `personalizedPageRank(nodes, edges, seed, o?)` · `rarestTerms(ix, text, n)` | 40, 06 | `retriever` (channels + fusion) |
| `context/pack.ts` | `PackItem` · `ContextPack` (incl. `path: "full" \| "quick" \| "none"`) · `EMPTY_PACK` · `assemblePack(ix, ranked, pins, budget)` · `outlineOf(f, max?)` · `renderPack(p)` | 40, 06 | `autoContextService` |
| `context/symbolPack.ts` | `PackTask` · `TASK_CAPS` · `SymbolFacts` · `SymbolPack` · `shapeSymbolPack(f, task, maxTokens)` · `renderSymbolPack(p)` · `extractHoverSignature(contents, cap?)` | 40 | `contextBridgeTools` `pack_context` |
| `context/mentions.ts` | `Pin` · `parseMentions(text, ix): { pins; unresolved; clean }` | 40 | |
| `crew/policy.ts` | `CREW = { perRequest: 3, hardStop: 8 }` · `WatchState` · `emptyWatch()` · `crewWatch(s, e)` · `commandPolicy(cmd)` | 50 §6, 30 | `subagentLifecycle` caps |
| `crew/evidence.ts` | `MemberStatus` · `isTerminal(s)` · `MemberEvidence` · `emptyEvidence()` · `assessMemberOutcome(o)` | 50 §4 | `assessWorkerOutcome` |
| `crew/board.ts` | `BoardEntry` · `class Board { write; read }` | 50 §5 | team board |
| `latency/stats.ts` | `ModelStat` · `emptyStat(fqn)` · `record(s, r, now)` · `percentile(xs, p)` · `orderModels(prefs, stats, now, byLatency)` · `hedgeDelayMs(s)` · `stallMs(s)` · `IDLE_STALL_MS = 45_000` | 60 | stream watchdog |
| `latency/hedge.ts` | `Attempt<T>` · `hedged(a, b, delayMs, outer, timer?)` (uses `Timer` from `context/budget.ts`) | 60 | |
| `latency/marks.ts` | `MarkName` · `class Marks { mark; span; line }` | 60 | |
| `instructions/frontmatter.ts` | `Front` · `parseFrontmatter(src): Front` · `listAttr(a, key)` · `boolAttr(a, key)` | 85 | `skillsService` parser |
| `instructions/load.ts` | `Trigger` · `Instruction` · `InstructionSet` · `INSTRUCTION_FILES` · `FILE_CAP(path)` · `loadInstructions(host)` · `selectInline(set, files, budget?)` · `activeSkills(set, request, files, budget?)` · `renderInstructions(base, sel, skills)` · `renderActiveSkills(skills)` · `globToRegExp(g)` · `expandWorkflow(set, input)` | 85 | `WORKSPACE_INSTRUCTION_PATHS`, `<skills_index>` |
| `panel/index.ts` | re-exports `panel/events`, `panel/reducer`, `panel/coalesce`. **The only agent-core entry the webview may import** (`@co4fe3/agent-core/panel`). Type-only imports from outside `panel/`. | 05 | |
| `panel/events.ts` | `PanelEvent` · `UiCommand` · `HunkView { id; oldStart; oldLines; newLines }` | 05 | |
| `panel/reducer.ts` | `PanelState` · `Row` · `emptyPanel(): PanelState` · `rowId(e): string` · `applyPanelEvent(s, e): PanelState` | 05 | |
| `panel/coalesce.ts` | `coalesce(batch: readonly PanelEvent[]): PanelEvent[]` | 05 | |
| `util/stable.ts` | `stableStringify(v): string` · `sha256Hex(s): string` | 02 | |
| `util/jail.ts` | `class ToolInputError extends Error` · `jail(root, p): string` | 30 | |
| `util/truncate.ts` | `truncateWithHint(text, max, hint): string` | 40 | "TRUNCATED … re-run …" |
| `util/redact.ts` | `redact(s): string` (keys, bearer tokens, `Authorization:` values) | 70 | |
| `util/queue.ts` | `class KeyedQueue { run<T>(key, fn: () => Promise<T>): Promise<T> }` | 30 | |
| `util/abort.ts` | `realSleep(ms, signal?): Promise<void>` | 70 | |

## ext: `extensions/co4fe3-vscode/src`

| File | Exports | Rule / workflow |
|---|---|---|
| `extension.ts` | `activate(ctx)` · `deactivate()` (wiring only, < 150 ms) | 10 |
| `config.ts` | `Config` · `readConfig(): Config` (every `co4fe3.*` setting, typed) | — |
| `status.ts` | `class StatusItems { trueforge; model; mode; ttft; undo }` | 02, 60 |
| `host/editorHost.ts` | `createEditorHost(ctx, out): EditorHost` · `currentText(uri)` · `fullRange(doc)` · `problemsOf(uri)` (maps `vscode.languages.getDiagnostics`) | 10, 30 |
| `host/lsp.ts` | `createLspHost(root): LspHost` (built-in commands: `vscode.executeDocumentSymbolProvider`, `executeReferenceProvider`, `prepareCallHierarchy` + `provideIncomingCalls`, `executeHoverProvider`) | 40 |
| `host/commands.ts` | `runCapped(cmd, cwd, timeoutMs, inactivityMs, maxBytes, signal)` · `rgPath()` · `rgSearch(root, q, signal)` (**the only `child_process` file**) | skill vscode-extension |
| `review/apply.ts` | `createApplier(root, log, onChange): Applier & { last(); ofTurn(turnId) }` · `applyDecision(applier, p, d)` (**the only writer**) | 30 |
| `review/proposalDocs.ts` | `SCHEME = "co4fe3-proposal"` · `proposalUri(rel, key, side?)` · `class ProposalDocs` | 03 |
| `review/hunkLens.ts` | `class HunkLens` | 03 |
| `review/controller.ts` | `interface ReviewController { store; review(p, signal, o?); showStreaming(rel, key, before); preview(rel, key, text); closeStreaming(key, message?); closeTurn(turnId) }` · `createReviewController(ctx, deps)` | 03, 04 |
| `inline/inlineEdit.ts` | `registerInlineEdit(ctx, d)` · `targetLines(ed, ix): { start; end }` · `class PhaseBox { constructor(initial, onChange); to(p) }` (throws when `canAdvance` refuses) | 04 |
| `panel/panelView.ts` | `class PanelView implements WebviewViewProvider` (`PanelView.id = "co4fe3.panel"`) | 05 |
| `panel/bridge.ts` | `class Bridge { push; flush }` | 05 |
| `panel/agentTurn.ts` | `class AgentTurns { send(text); stop() }` | 05 |
| `panel/pause.ts` | `PauseDeps { host; review; crew; serverName; mode; turnKey; sideEffect; cfg }` · `makeOnPause(d): TurnHooks["onPause"]` (one review per file; profile gate; evidence) · `jailedPathArg(root, call): string \| null` | 05, 30, 50 |
| `panel/crew.ts` | `class Crew { constructor(mode, push); onEvent(e); member(threadId); setStatus(threadId, status); record(threadId, add); finish(threadId, report, failed); cancelAll(): PanelEvent[] }` (imports `briefOf` from core `forge/events.ts`) | 07, 50 §4 |
| `context/indexer.ts` | `class IndexStore { get(): RepoIndex \| null; set(ix); update(entry); packFor(text, active?, recent?): Promise<ContextPack> }` (uses `withinBudget`) · `indexWorkspaceInBackground(host, store, out)` | 06, 40 |
| `forge/sessions.ts` | `class SessionPool { warm(mode, model); take(mode, model); agent(instructions, mode): Promise<{ id; model }> }` (one chat session, reused across turns) · `registerEditorServer(client, name, mcp, status)` | 02, 08 |
| `forge/router.ts` | `InlineResult` · `class Router { order(mode); inline(prompt, ui, signal); agent(session, text, hooks, signal); label(mode); lastModel(); currentModel() }` | 08, 09 |

## web: `extensions/co4fe3-vscode/webview/src`

`main.tsx` (mounts the app and owns `acquireVsCodeApi()`) · `App.tsx` (a `useReducer` over `applyPanelEvent`, with
batch apply) · `md.tsx` (a tiny safe markdown renderer, React elements only) · `components/`: `Header` (mode chip
Agent/Ask/Plan, model picker), `Transcript`, `UserBubble`, `TextRow`, `Thoughts`, `ToolCard`, `MemberRow` (status
and profile chips, blocked reason), `MessageBubble`, `PackCard` (per-channel ranks), `BoardCard`, `DiffCard`
(new-errors line), `CommandCard`, `ModelBanner`, `StatusLine`, `Composer`.

## The 11 MCP tools (`mcp/server.ts`, registered in this read-first order; the coder agent preloads them all)

`repo_map{query, budget_tokens=2500}` · `search_workspace{pattern, regex=false, glob?}` · `find_symbol{name}` ·
`pack_context{path, symbol, task="understand"|"refactor"|"debug"|"extend", max_tokens=3000}` ·
`read_file{path, offset=1, limit=400}` · `list_changes{}` · `board_read{key?}` · `board_write{key, value, by}` ·
`load_instructions{kind: "rule"|"skill"|"file", name}` ·
`propose_edit{path, why, edits?[{old_string,new_string}], content?}` **gated (edits)** ·
`run_command{command, timeout_s=120}` **gated (terminal)**.

`check-invariants.mjs` compares this section with `runtime/modes.ts` `TOOLS` and with `mcp/server.ts`.

## Commands, keybindings and settings

The full list is in the `vscode-extension` skill's `package.json`. The ids:

- inline edit and review: `co4fe3.inlineEdit` (Ctrl/Cmd+Alt+K), `co4fe3.inlineCancel` (Esc while busy),
  `co4fe3.hunk.accept|reject`, `co4fe3.hunk.acceptAtCursor|rejectAtCursor` (Alt+Y/Alt+N),
  `co4fe3.proposal.acceptAll|rejectAll`;
- undo: `co4fe3.undoLast`, `co4fe3.revertTurn`;
- modes: `co4fe3.cycleMode` (Ctrl+. in the panel);
- models and TrueForge: `co4fe3.pickModel`, `co4fe3.resetStats`, `co4fe3.openSession`, `co4fe3.startTrueForge`;
- development mode only: `co4fe3.dev.sampleProposal`, `co4fe3.dev.rank`.

Settings: `co4fe3.trueforge.url`, `co4fe3.trueforge.command`, `co4fe3.models.order`, `co4fe3.mode`
(`agent`|`ask`|`plan`), `co4fe3.crew.enabled`, `co4fe3.context.packTokens`, `co4fe3.latency.autoOrderInline`,
`co4fe3.latency.hedgeInline`, `co4fe3.commands.timeoutSeconds`, `co4fe3.autoApprove.terminal`. The contributed default
is `diffEditor.codeLens: true`. Context keys: `co4fe3.inlineBusy`, `co4fe3.devMode`. State:
`globalState["co4fe3.stats.v1"]`, checkpoints in `storageUri/checkpoints.json`.

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
  - panel and the rest: `reducer`, `coalesce`, `frontmatter`, `instructions`, `mcp-tools`, `redact`;
  - perf: `perf/*.perf.test.ts` and `perf/synth.ts`.
- `test/integration/`: `global-setup.ts`, `harness.ts`, `roundtrip`, `mcp`, `approval`, `cancel`, `crew`,
  `fallback`, `overhead`.
- `test/fakes/fake-openai.ts`.
- `extensions/co4fe3-vscode/test/`: `activation.test.ts`, `inline.test.ts`, `pause.test.ts` (one review per file,
  profile gate; it runs in the extension host because `pause.ts` is extension code).
