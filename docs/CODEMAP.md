# CODEMAP

Every planned file, its layer and its exact exports. **This is the source of truth for names.** If a name is not
here, in rule 20 or in a `.d.ts`, it does not exist yet. Add it here in the same commit that creates it.
Status: `planned` until the file exists, then `done`. Keep this file sorted by path.

Layers: **core** = `packages/agent-core/src` (pure, no vscode). **ext** = `extensions/co4fe3-vscode/src`.
**web** = `extensions/co4fe3-vscode/webview/src`.

## core: `packages/agent-core/src`

| File | Exports (exact) | Rule / workflow |
|---|---|---|
| `index.ts` | re-exports everything below except `panel/*` | — |
| `host.ts` | `interface EditorHost { root; readText(rel); listFiles(limit?); search(q, signal); run(req, signal); now() }` · `SearchQuery` · `SearchHit` · `CommandRequest` · `CommandResult` · `interface Applier { apply(change); undo(checkpointId) }` · `FileChange` · `ApplyResult` | 10 |
| `forge/client.ts` | `makeClient(baseUrl: string): TrueForge` · `STREAM` · `ONCE` · `health(client, signal?): Promise<{ok:true}\|{ok:false;detail:string}>` · `sessionUrl(base: string, sessionId: string): string` (pattern from spike row 8) | 20, 01 |
| `forge/turn.ts` | `TfEvent` · `EventIndex` · `PendingCall` · `TurnHooks` · `TurnOutcome` · `runTurn(i): Promise<TurnOutcome>` · `findCall(index, sourceEventId, id)` · `textOf(c: unknown): string` · `allow(p)` · `deny(p, reason)` · `reply(p, content)` | 20 |
| `forge/events.ts` | `messageText(index, id): string` · `toolNameOf(call, server): string \| null` · `safeJson(s: string \| undefined): unknown` · `briefOf(e: thread.created event): string` | skill trueforge-sdk, 50 |
| `forge/fromForge.ts` | `fromForge(e: TfEvent, index: EventIndex): PanelEvent[]` | 05 |
| `forge/spec.ts` | `buildSpec(file: AgentSpec, o: { model; editorServer; instructions?; contextLength?; crew? }): AgentSpec` | 07 |
| `forge/fallback.ts` | `FailKind` · `Failure` · `classifyFailure(message): Failure` · `retryAfterMs(m): number \| null` · `backoffMs(n, rand?): number` · `AttemptResult { outcome; sideEffects; firstTokenMs }` · `RunOn` · `Note` · `runWithFallback(models, runOn, note, signal, sleep?)` · `class AttemptFailed extends Error { model; failure }` | 70, 08 |
| `forge/attempt.ts` | `AttemptUi { onText(full, threadId); onStatus(s); onEvent?; onPause? }` · `attemptTurn(a, ui, signal, now?): Promise<AttemptResult>` | 08 |
| `forge/messages.ts` | `failureLine(model, f): string` · `allFailedLine(failures): string` · `noteLine(n: Note): string` | 70 |
| `mcp/http.ts` | `McpHttp { url; token; close() }` · `startMcpHttp(make: () => McpServer, log): Promise<McpHttp>` | 02 |
| `mcp/schemas.ts` | `ProposeEditShape` · `ProposeEdit` (zod) · `type ProposeEdit` · `RunCommandShape` · `RunCommand` · `proposalKey(rel, v): string` | 02 |
| `mcp/server.ts` | `McpDeps` · `ToolResult` · `createEditorMcpServer(d: McpDeps): McpServer` · `mcpServerNameFor(root): string` (`co4fe3-ws-<8 hex>`) | 02 |
| `review/lines.ts` | `splitLines(s): string[]` · `eolOf(s): "\r\n" \| "\n"` | 30 |
| `review/hunks.ts` | `Hunk { id; oldStart; oldLines; newLines }` · `toHunks(before, after): Hunk[]` · `applyHunks(before, hunks, take): string` · `previewLines(hunks, include): Map<string, number>` | 30, 03 |
| `review/edits.ts` | `EditOp { oldString; newString }` · `Plan` · `planEdit(before, ops, content?): Plan` | 30 |
| `review/store.ts` | `Proposal` · `Decision` · `class ReviewStore { stage; get; onChange; decide; decideAll; settled; take; dropTurn }` | 30 |
| `review/checkpoints.ts` | `Checkpoint` · `class CheckpointLog { push; get; last; ofTurn; markUndone; toJSON }` | 03 |
| `review/inline.ts` | `extractFence(s, done)` · `streamingPreview(original, partial)` · `assembleInline(text, start, end, code)` · `buildInlinePrompt(i)` | 04 |
| `context/tokens.ts` | `estimateTokens(s): number` | 40 |
| `context/budget.ts` | `BUDGET = { pack: 6000, packCap: 12000, firstMessage: 12000, inline: 3000, readLines: 400, readLinesCap: 800, searchHits: 50, repoMap: 2500, repoMapCap: 4000, commandBytes: 16384 }` | 40 |
| `context/symbols.ts` | `Sym` · `extractSymbols(path, text): Sym[]` | 40 |
| `context/repomap.ts` | `FileEntry` · `RepoIndex` · `RankQuery` · `Ranked` · `indexFile(path, text)` · `buildIndex(entries)` · `rankFiles(ix, q)` · `queryTerms(text)` · `stem(w)` · `termMatches(term, token)` · `lexicalScore(f, terms, idf)` · `personalizedPageRank(nodes, edges, seed, o?)` | 40, 06 |
| `context/pack.ts` | `PackItem` · `ContextPack` · `assemblePack(ix, ranked, pins, budget)` · `outlineOf(f, max?)` · `renderPack(p)` | 40, 06 |
| `context/mentions.ts` | `Pin` · `parseMentions(text, ix): { pins; unresolved; clean }` | 40 |
| `crew/roles.ts` | `Role` · `ALLOWED` · `parseRole(brief): Role` · `memberMayCall(role, tool): boolean` | 50 |
| `crew/policy.ts` | `CREW` · `class RepeatGuard { hit; endTurn }` · `WatchState` · `emptyWatch()` · `crewWatch(s, e)` · `commandPolicy(cmd)` | 50, 30 |
| `crew/board.ts` | `BoardEntry` · `class Board { write; read }` | 50 |
| `latency/stats.ts` | `ModelStat` · `emptyStat(fqn)` · `record(s, r, now)` · `percentile(xs, p)` · `orderModels(prefs, stats, now, byLatency)` · `hedgeDelayMs(s)` · `stallMs(s)` | 60 |
| `latency/hedge.ts` | `Attempt<T>` · `Timer` · `realTimer` · `hedged(a, b, delayMs, outer, timer?)` | 60 |
| `latency/marks.ts` | `MarkName` · `class Marks { mark; span; line }` | 60 |
| `instructions/frontmatter.ts` | `Front` · `parseFrontmatter(src): Front` | 85 |
| `instructions/load.ts` | `Trigger` · `Instruction` · `InstructionSet` · `loadInstructions(host)` · `selectInline(set, files, budget?)` · `renderInstructions(base, sel)` · `globToRegExp(g)` · `expandWorkflow(set, input)` | 85 |
| `panel/index.ts` | re-exports `panel/events`, `panel/reducer`, `panel/coalesce`. **The only agent-core entry the webview may import** (`@co4fe3/agent-core/panel`). Type-only imports from outside `panel/`. | 05 |
| `panel/events.ts` | `PanelEvent` · `UiCommand` · `HunkView { id; oldStart; oldLines; newLines }` | 05 |
| `panel/reducer.ts` | `PanelState` · `Row` · `emptyPanel(): PanelState` · `rowId(e): string` · `applyPanelEvent(s, e): PanelState` | 05 |
| `panel/coalesce.ts` | `coalesce(batch: readonly PanelEvent[]): PanelEvent[]` | 05 |
| `util/stable.ts` | `stableStringify(v): string` · `sha256Hex(s): string` | 02 |
| `util/jail.ts` | `class ToolInputError extends Error` · `jail(root, p): string` | 30 |
| `util/redact.ts` | `redact(s): string` (keys, bearer tokens, `Authorization:` values) | 70 |
| `util/queue.ts` | `class KeyedQueue { run<T>(key, fn: () => Promise<T>): Promise<T> }` | 30 |
| `util/abort.ts` | `realSleep(ms, signal?): Promise<void>` | 70 |

## ext: `extensions/co4fe3-vscode/src`

| File | Exports | Rule / workflow |
|---|---|---|
| `extension.ts` | `activate(ctx)` · `deactivate()` (wiring only, < 150 ms) | 10 |
| `config.ts` | `Config` · `readConfig(): Config` (every `co4fe3.*` setting, typed) | — |
| `status.ts` | `class StatusItems { trueforge; model; ttft; undo }` | 02, 60 |
| `host/editorHost.ts` | `createEditorHost(ctx, out): EditorHost` · `currentText(uri)` · `fullRange(doc)` | 10 |
| `host/commands.ts` | `runCapped(cmd, cwd, timeoutMs, maxBytes, signal)` · `rgPath()` · `rgSearch(root, q, signal)` (**the only `child_process` file**) | skill vscode-extension |
| `review/apply.ts` | `createApplier(root, log, onChange): Applier & { last(); ofTurn(turnId) }` · `applyDecision(applier, p, d)` (**the only writer**) | 30 |
| `review/proposalDocs.ts` | `SCHEME = "co4fe3-proposal"` · `proposalUri(rel, key, side?)` · `class ProposalDocs` | 03 |
| `review/hunkLens.ts` | `class HunkLens` | 03 |
| `review/controller.ts` | `interface ReviewController { store; review(p, signal, o?); showStreaming(rel, key, before); preview(rel, key, text); closeStreaming(key, message?); closeTurn(turnId) }` · `createReviewController(ctx, deps)` | 03, 04 |
| `inline/inlineEdit.ts` | `registerInlineEdit(ctx, d)` · `targetLines(ed, ix): { start; end }` | 04 |
| `panel/panelView.ts` | `class PanelView implements WebviewViewProvider` (`PanelView.id = "co4fe3.panel"`) | 05 |
| `panel/bridge.ts` | `class Bridge { push; flush }` | 05 |
| `panel/agentTurn.ts` | `class AgentTurns { send(text); stop() }` | 05 |
| `panel/pause.ts` | `PauseDeps` · `makeOnPause(d): TurnHooks["onPause"]` | 05 |
| `panel/crew.ts` | `class Crew { onEvent(e); member(threadId) }` (imports `briefOf` from core `forge/events.ts`) | 07 |
| `context/indexer.ts` | `class IndexStore { get(): RepoIndex \| null; set(ix); update(entry); packFor(text, active?): Promise<ContextPack> }` (waits ≤ 1.5 s for the first build) · `indexWorkspaceInBackground(host, store, out)` | 06, 40 |
| `forge/sessions.ts` | `class SessionPool { warm(mode, model); take(mode, model); agent(instructions): Promise<{ id; model }> }` (one chat session, reused across turns) · `registerEditorServer(client, name, mcp, status)` | 02, 08 |
| `forge/router.ts` | `InlineResult` · `class Router { order(mode); inline(prompt, ui, signal); agent(session, text, hooks, signal); label(mode); lastModel(); currentModel() }` | 08, 09 |

## web: `extensions/co4fe3-vscode/webview/src`

`main.tsx` (mounts the app and owns `acquireVsCodeApi()`) · `App.tsx` (a `useReducer` over `applyPanelEvent`, with
batch apply) · `md.tsx` (a tiny safe markdown renderer, React elements only) · `components/`: `Header`, `Transcript`,
`UserBubble`, `TextRow`, `Thoughts`, `ToolCard`, `MemberRow`, `MessageBubble`, `PackCard`, `BoardCard`, `DiffCard`,
`CommandCard`, `ModelBanner`, `StatusLine`, `Composer`.

## The 10 MCP tools (`mcp/server.ts`; the coder agent preloads them all)

`read_file{path, offset=1, limit=400}` · `search_workspace{pattern, regex=false, glob?}` · `find_symbol{name}` ·
`repo_map{query, budget_tokens=2500}` · `propose_edit{path, why, edits?[{old_string,new_string}], content?}` **gated** ·
`run_command{command, timeout_s=120}` **gated** · `board_read{key?}` · `board_write{key, value, by}` ·
`list_changes{}` · `load_instructions{kind: "rule"|"skill", name}`.

## Commands, keybindings and settings

The full list is in the `vscode-extension` skill's `package.json`. The ids:

- inline edit and review: `co4fe3.inlineEdit` (Ctrl/Cmd+Alt+K), `co4fe3.inlineCancel` (Esc while busy),
  `co4fe3.hunk.accept|reject`, `co4fe3.hunk.acceptAtCursor|rejectAtCursor` (Alt+Y/Alt+N),
  `co4fe3.proposal.acceptAll|rejectAll`;
- undo: `co4fe3.undoLast`, `co4fe3.revertTurn`;
- models and TrueForge: `co4fe3.pickModel`, `co4fe3.resetStats`, `co4fe3.openSession`, `co4fe3.startTrueForge`;
- development mode only: `co4fe3.dev.sampleProposal`, `co4fe3.dev.rank`.

Settings: `co4fe3.trueforge.url`, `co4fe3.trueforge.command`, `co4fe3.models.order`, `co4fe3.crew.enabled`,
`co4fe3.context.packTokens`, `co4fe3.latency.autoOrderInline`, `co4fe3.latency.hedgeInline`,
`co4fe3.commands.timeoutSeconds`. The contributed default is `diffEditor.codeLens: true`.
Context keys: `co4fe3.inlineBusy`, `co4fe3.devMode`. State: `globalState["co4fe3.stats.v1"]`, checkpoints in
`storageUri/checkpoints.json`.

## Scripts and data

`scripts/verify.mjs` · `check-invariants.mjs` · `setup-trueforge.mjs` · `bench-latency.mjs` · `smoke-live.mjs` ·
`save-agents.mjs` · `spike.mjs` (throwaway, workflow 01) · `hooks/*.sh`. `agents/co4fe3-coder.agent.json` and
`agents/co4fe3-inline.agent.json` (placeholders `$MODEL` and `$EDITOR`) · `config/providers.example.json`.

## Tests

- `packages/agent-core/test/`: `hunks`, `edits`, `store`, `checkpoints`, `jail`, `inline`, `tokens`, `symbols`,
  `repomap`, `pack`, `mentions`, `roles`, `policy`, `board`, `fallback`, `stats`, `hedge`, `marks`, `reducer`,
  `coalesce`, `fromForge`, `instructions`, `spec`, `turn`, `mcp-tools`, `redact`, plus `perf/*.perf.test.ts` and
  `perf/synth.ts`.
- `test/integration/`: `global-setup.ts`, `harness.ts`, `roundtrip`, `mcp`, `approval`, `cancel`, `crew`,
  `fallback`, `overhead`.
- `test/fakes/fake-openai.ts`.
- `extensions/co4fe3-vscode/test/`: `activation.test.ts`, `inline.test.ts`.
