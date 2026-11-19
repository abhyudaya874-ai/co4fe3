# Study: V3Code (reference architecture)

Repository: `/home/de3p/V3Code`, https://github.com/HeavenFYouMissed/V3Code, read at commit `2eac91fb` (19 Nov 2026).
V3Code is a Code-OSS fork built on Void Editor. Licences: V3Code and Void are Apache-2.0 (`LICENSE`, `NOTICE.txt`);
Code-OSS is MIT (`LICENSE.txt`); some files carry their own headers (`LICENSING.md`). The V3Code name and logo are
KandD Labs trademarks and are not covered by the licence.

**How co4fe3 uses it: architecture and concepts only, no copied code.** Every idea below is reimplemented in our
own words and code. Read the file to understand the idea, close it, then write ours. If a rule ever needs a
verbatim excerpt, it must keep V3Code's licence header and be listed in `NOTICE`, per V3Code's own `AGENTS.md`.
co4fe3 is a VS Code extension, not a fork, so anything that needs workbench internals (Monaco view zones, React
inside the workbench, the Rust Beast sidecar) is mapped to the public extension API or left out.

All paths below are relative to `src/vs/workbench/contrib/void/` unless stated.

## 1. Agent runtime policy: `common/localAgentRuntime.ts` (adapted from the Cline SDK design, Apache-2.0)

- Repeat detection works on the **signature of a whole tool batch** (the calls joined), not on single calls:
  `LOCAL_AGENT_REPEAT_SOFT_THRESHOLD = 3` (a reminder is added to the result) and
  `LOCAL_AGENT_REPEAT_HARD_THRESHOLD = 5` (the batch is blocked).
- **Consecutive-mistake limit**: when every result in a batch is an error, a counter goes up; any success resets
  it. At the limit (2 for small models, 3 otherwise) all further tools in the turn are blocked and the model is
  told to explain the blocker.
- Iteration caps by model size, parsed from the model name: 12 / 20 / 40 (`localAgentRuntimeLimits`).
- One "recovery" per turn each for an empty, reasoning-only reply and for a reply whose closing sentence promises
  work it never did (`localNarrationNeedsRecovery`).
- The class **never runs models or tools**. It returns decisions (`{ block, reminder }`), and the host that owns
  streaming, approvals and cancel applies them. Tested as pure code (`test/common/localAgentRuntime.test.ts`).

## 2. Modes restrict tools: `common/prompt/prompts.ts` `availableTools(chatMode, mcpTools)`

- `ChatMode = 'agent' | 'read' | 'chat' | 'plan' | 'multitask' | 'debug'` (`common/voidSettingsTypes.ts`).
- **"Read-only" is defined as "has no approval category"**: `readOnlyToolNames = builtin tools not in
  approvalTypeOfBuiltinToolName`. Each mode's tool list is derived from that one map, so adding a gated tool can
  never widen read mode by accident.
  - chat: no tools; read: the read-only set; plan: read-only plus markdown writes (still approval-gated);
  - debug: read-only plus a bounded fix set (edit, run_command, run_tests); agent: everything plus MCP.
- Tools are ordered **read-first** (search and structure tools first), because models treat list position as
  priority. Duplicate names are removed (`uniqueToolsByName`), because some providers reject the whole request.

## 3. Approvals: `common/toolsServiceTypes.ts`, `browser/chatThreadService.ts`

- `approvalTypeOfBuiltinToolName: { [tool]: 'edits' | 'terminal' | 'MCP tools' | 'computer' | 'projects' }`.
  Settings hold a per-category auto-approve. Non-builtin (MCP) tools are always `'MCP tools'`.
- Tool message states: `'invalid_params' | 'tool_request' | 'running_now' | 'tool_error' | 'success' |
  'rejected'`. A gated call becomes a `tool_request`, the loop ends with `isRunning: 'awaiting_user'`, and
  approval re-enters the loop with that call pre-approved (`approveLatestToolRequest`, `callThisToolFirst`).
- A checkpoint is taken **before** every `edit_file` / `rewrite_file`.
- Fixed error texts: "Tool call was rejected by the user." / "Tool call was interrupted by the user."

## 4. Subagents: `common/subagentLifecycle.ts`, `common/toolsServiceTypes.ts`

- One canonical status vocabulary shared by the service and the UI: `'queued' | 'running' | 'waiting-approval'
  | 'completed' | 'blocked' | 'failed' | 'cancelled'`; terminal = completed / blocked / failed / cancelled.
- Caps: 3 running per parent, 8 total, 5 queued per parent, nesting depth 2. Admission is a **pure function**
  (`subagentAdmission`) that returns `{ ok, queued?, reason }` with a sentence the model can act on.
- Two **capability profiles**, enforced at execution time and mirrored in the advertised tool list:
  `research` (read-only: builtin, no approval category, minus an explicit deny list) and `work` (the parent's
  surface minus parent-only tools: ask_user, update_plan, open_project, message_subagent …).
- **Evidence over claims**: each worker's own tool calls are folded into `SubagentEvidence { filesTouched,
  commandsRun, toolsRun }`. `assessWorkerOutcome` marks a worker `blocked` when its report claims edits that no
  tool call of its own made.
- Results come back as one notification in the parent thread: `[Background subagent "<desc>" <status> <evidence>]`
  plus the report cut at 4,000 chars. Stopping a parent cascades to its children. Rejecting a child's approval
  finalises it as `blocked` with a reason (never silently back to running).
- Siblings never message each other: `message_subagent` is a parent-only tool.

## 5. Cancel: `browser/chatThreadService.ts` `abortRunning`

Order: stamp the child `cancelled` first (so nothing re-launches it), keep the partial assistant text, add an
`interrupted_streaming_tool` marker for a half-streamed call (never executed), rewrite a running tool as
`rejected` ("interrupted by the user") and call its interrupt, reject a pending approval, add a checkpoint, then
cancel children. In the native agent, the cancel token is checked before every batch and every tool, and a batch
with any mutating call runs sequentially (read-only batches run in parallel).

## 6. Budgets and truncation: `common/prompt/prompts.ts`, `common/tokenBudget.ts`, `browser/toolsService.ts`

- Caps: `MAX_FILE_CHARS_PAGE = 500_000`, `MAX_DIRSTR_CHARS_TOTAL_TOOL = 20_000`, `MAX_TERMINAL_CHARS = 100_000`,
  `MAX_WRITE_TOOL_CONTENT_CHARS = 64_000` (an oversized write is refused **before** anything is written).
- **Every truncation says what to do next** (e.g. "...TRUNCATED … re-run read_lint_errors for the rest").
- Token budget display: 4 chars/token, warning at 75%, critical at 90% (`computeTokenBudget`).
- Terminal: 8 s inactivity, 120 s wall clock; the timeout reason is typed (`cause: 'handoff' | 'inactivity' |
  'wall_clock'`). Git commands that time out say "do NOT assume it succeeded".
- Stream watchdog (`browser/v3codeLlmStreamWatchdog.ts`): a stall timer reset on every delta (120 s), a longer one
  for a slow first token (300 s).

## 7. Search/replace edit format: `common/prompt/prompts.ts`

`<<<<<<< ORIGINAL` / `=======` / `>>>>>>> UPDATED` blocks inside a fenced block (Void's format).

## 8. Instructions and skills: `browser/convertToLLMMessageService.ts`, `browser/skillsService.ts`

- Instruction files read: `AGENTS.md`, `.github/copilot-instructions.md`, `.github/AGENTS.md`, `CLAUDE.md`,
  `.voidrules`, `.v3coderules`, `.cursorrules`. 16,000 chars per file; AGENTS.md is cut at 8,000 with a note and
  a warning past 6,000.
- Skills: `<dir>/SKILL.md` under `.v3code/skills` (bundled → `~/.v3code/skills` → workspace; later wins).
  `SkillDescriptor { name, description, showInCatalog, triggers: { globs?, keywords?, alwaysApply?,
  loadOnDemand? }, content }`. The prompt carries a `<skills_index>` (name + summary) and `<active_skills>` (matched
  by glob or keyword); the model loads the rest with a `read_skill` tool.

## 9. Tests

mocha TDD (`suite` / `test`) with Node `assert`. Policy is pulled out into pure modules **because the thread
service has no DI test harness** (`subagentLifecycle.ts` header). Relevant files under `test/common/`:
`localAgentRuntime`, `subagentPolicy`, `subagentObservability`, `planModeTools`, `debugMode`, `multitask`,
`uniqueToolNames`, `toolsRegistryDrift`, `v3codeLlmStreamWatchdog`, `tokenUsageCost`.

## 10. Edits and review: `browser/editCodeService.ts`, `common/editCodeServiceTypes.ts`

- Data model: a `DiffZone { originalCode, startLine, endLine, _diffOfId, _streamState }` holds many
  `Diff = ComputedDiff & { diffid }`, where `ComputedDiff` is `'edit' | 'insertion' | 'deletion'` with original and
  new line ranges. A `CtrlKZone` is the inline input; `TrackingZone` follows a region.
- **V3Code writes the streamed text into the editor buffer immediately** and keeps `originalCode` in the zone.
  Accepting a diff folds it into `originalCode`; rejecting one writes the original lines back into the buffer.
- Every accept/reject goes through `_addToHistory(uri)`: it snapshots the whole file plus its zones, pushes an
  undo element onto VS Code's undo stack, and `onFinishEdit` saves the model.
- `StartBehavior = 'accept-conflicts' | 'reject-conflicts' | 'keep-conflicts'` decides what happens when a new
  edit lands on a file that still has pending diffs.
- Interrupting a stream undoes the partial write (`interruptURIStreaming` → `_undoHistory`).
- **Why co4fe3 does not copy this model:** it needs Monaco decorations and view zones inside the workbench, and
  it touches the buffer before the user decides. The Forge-a-thon requires "no silent writes to disk", and an
  extension cannot draw V3Code's inline zones. co4fe3 keeps the proposal in a separate virtual document shown in
  VS Code's diff editor, and writes once, after the decision (rule 30). We take the *ideas*: whole-file
  before/after snapshots for undo, an explicit policy for edits that conflict on one file, and undo of partial work.

## 11. Turbo Draft: `common/turboDraft*.ts`, `browser/turboDraftService.ts`

- **Run state is a monotonic state machine** (`turboDraftRunState.ts`): phases only move forward, terminal phases
  are sticky (`canTransitionTurboDraftPhase`), and a `sourceChanged` terminal phase exists for "the file changed
  while drafting". Stages advance only on real checkpoints, never on timers.
- **Hunk quality gate** (`turboDraftHunkQuality.ts`) uses a closed reject-reason union: `'no-blocks' |
  'ambiguous-markers' | 'empty-orig-and-final' | 'unanchored-insertion' | 'not-found' | 'not-unique' | 'unchanged'
  | 'too-large' | 'overlap' | 'aggregate-noop' | 'partial-reject'`. Each block is capped at 12,000 chars.
  Individually valid blocks from a rejected response are kept as "salvageable".
- **Compiler truth** (`turboDraftCompilerTruth.ts`): errors are listed first, then sorted by line, at most 12
  diagnostics; the 8 signatures nearest the cursor (within 60 lines) come from hover; at most 6 call sites.
- **Verify after apply** (`turboDraftVerify.ts`): the question is "did the draft break something that was fine?".
  Problems are diffed against a baseline taken before the edit, and identity is `code + normalised message`, never
  position (lines move). Counts matter: three copies where there was one means two are new. Only errors count.
  The follow-up prompt says "fix exactly these errors and nothing else" (at most 8 listed).
- Nothing is saved until the developer approves; per-change accept/reject uses the same DiffZones as §10.

## 12. Retrieval: `common/semanticIndex/*`, `browser/autoContextService.ts`, `beast/`

- **Reciprocal Rank Fusion** (`rrf.ts`): `score(d) = Σ_channels 1 / (k + rank(d))` with `k = 60` (Cormack et al.,
  SIGIR 2009). The function is pure and also returns each item's rank in every channel (0 = absent).
- `retriever.ts` fuses up to 4 channels (original-query vector, code-terms vector, hypothetical-code vector, BM25
  full-text). A missing channel is skipped silently, so "partial signal is better than no result". The candidate
  pool per channel is `max(2 × topK, 60)`.
- **Retrieval never blocks the first token unbounded** (`retrieveBudget.ts`): the full retrieve gets 3,000 ms, then
  a lexical-only quick path gets 500 ms, then the turn goes out with no auto-context. It never rejects.
- `autoContextService.ts`: stopwords, camelCase splitting, top 15 hits, deduplicated to the 5 best files, at most
  500 lines each, 4 chars/token estimate.
- Chunking: tree-sitter units, falling back to 80-line windows with a 10-line overlap (`chunker.ts`).
- Beast (Rust sidecar, optional, off until it passes its evaluation gate): trigram/BM25, symbols, references,
  impact. "Files remain the source of truth": every hit is re-read from the file before use.
- co4fe3 has no embedding model and no sidecar, so it keeps the **structure** (several cheap ranked channels fused
  with RRF, a budget with a lexical fallback, per-channel ranks as the explanation) and swaps in its own channels.

## 13. Context Bridge: `browser/contextBridge/contextBridgeTools.ts`, `lspBridgeAdapter.ts`

- LSP-backed tools give the agent compiler facts instead of guesses: definitions, references, call hierarchy,
  type hierarchy, document symbols, diagnostics (the marker service) and hover signatures.
- `pack_context(file_path, symbol_name, task, max_tokens = 3000)` returns one bundle shaped by intent. Per-task caps
  (`CAPS`): understand `{callers 3, references 4, callerCtx 8}`, refactor `{10, 8, 4}`, debug `{6, 4, 6}`,
  extend `{4, 2, 4}`. The definition, notes and diagnostics are always included.
- **Budget trim order**: drop references first, then blank caller snippets, then drop callers. A definition longer
  than `2 × max_tokens` chars is cut with a "[Definition truncated; request a narrower symbol…]" note. The output
  reports what was dropped (`meta.truncated`).
- Tool descriptions start with **WHEN:** ("WHEN: you know file_path + symbol_name and are about to work on it")
  and say which sibling tool to use instead.
- The public VS Code API reaches the same facts through built-in commands (verified on
  code.visualstudio.com/api/references/commands): `vscode.executeDocumentSymbolProvider`,
  `vscode.executeDefinitionProvider`, `vscode.executeReferenceProvider`, `vscode.prepareCallHierarchy` +
  `vscode.provideIncomingCalls`, `vscode.executeHoverProvider`, plus `vscode.languages.getDiagnostics(uri)`.

## 14. MCP bridge: `common/mcpExpose/*`, `browser/mcpExposeContribution.ts`, `.v3code/mcp/v3code-mcp-bridge.mjs`

- V3Code exposes its own tools as an MCP server on loopback (`V3CODE_MCP_DEFAULT_PORT = 7333`, next free port on
  clash), one endpoint descriptor file per running editor, and an optional owner-only bearer token
  (`/^[a-f0-9]{48}$/`). The stdio bridge accepts only `http:` loopback endpoints and never replays a tool call
  against another editor after a failure.
- Every tool result is bounded before it leaves (`boundMcpText`, 15,000 tokens, or the `max_tokens` the call asked
  for). Structured output is trimmed so it stays valid JSON (`reviewChatTail`).
- Git arguments from a model are validated with strict patterns (no leading `-`, no `..`) before reaching the shell.
- A long job is accepted and polled, not awaited (`acceptReviewJob`): "acceptance is not completion".

## 15. What co4fe3 adopts, adapts or skips

| V3Code idea | co4fe3 | Where |
|---|---|---|
| Runtime policy object that only returns decisions (§1) | **adopt**: `TurnPolicy` with soft/hard repeat thresholds 3/5 and a consecutive-mistake safety stop. Counted per turn at the MCP handler, because TrueForge owns the batches | rule 50, `runtime/policy.ts` |
| Read-only = "no approval category"; modes derived from one map (§2, §3) | **adopt**: `APPROVAL` map; modes `agent / ask / plan` → TrueForge `enableTools`; read-first tool order | rule 50, `runtime/modes.ts` |
| Two subagent profiles, enforced at execution time (§4) | **adopt**: `PROFILE: research | work` in the brief, enforced at the approval pause; research is the default | rule 50 |
| Status vocabulary + evidence over claims (§4) | **adopt**: member status `running / waiting-approval / completed / blocked / failed / cancelled`; `assessMemberOutcome` | rule 50, `crew/evidence.ts` |
| Caps 3 per parent / 8 total (§4) | **adapt**: the lead may start 3 members per request; the watchdog stops at 8. TrueForge nests one level and does not queue | rule 50 |
| Cancel order (§5) | **adopt**: members cancelled first, then partial text kept with an "interrupted" marker, then pending reviews dropped | workflow 05 |
| Truncation always says what to do next (§6) | **adopt**: `truncateWithHint()` on every capped tool result, plus a last-line bound in `wrap()` | rule 40, PATTERNS P4 |
| Typed timeout cause; stream stall timer reset on every delta (§6) | **adopt**: `CommandResult.timedOut: "inactivity" | "wall_clock" | null`; idle stall in `attemptTurn`, paused while the user reviews | rules 30, 70 |
| In-buffer diff zones (§10) | **skip**: needs workbench internals and writes before the decision. We keep a proposal document + diff editor | rule 30, D20 |
| Conflict policy for edits on one file (§10) | **adapt**: one review per file per pause; later edits to that file are denied with a reason ("reject-conflicts") | rule 30 |
| Closed reject-reason union (§11) | **adopt**: `EditReject` reasons; `planEdit` reports every failing edit at once | rule 30 |
| Compiler truth + verify against a baseline (§11) | **adopt**: diagnostics in the inline prompt; after an apply, only *new* errors are reported to the model and the user | rule 30, `review/verify.ts` |
| Monotonic run state with `sourceChanged` (§11) | **adopt** for inline edit | workflow 04 |
| RRF k = 60 over several channels; partial channels allowed (§12) | **adopt**: lexical, graph (personalised PageRank), grep and recent channels fused with RRF; per-channel ranks are the "why" | rule 40, `context/rrf.ts` |
| Retrieval budget with a lexical fallback (§12) | **adopt**: full pack within 800 ms, quick path-only pack within 200 ms, else no pack | rule 40 |
| Embeddings, tree-sitter, Beast (§12) | **skip** for Round 1 (no model, no native deps); BACKLOG | D7, D8 |
| LSP-backed `pack_context` with per-task caps and trim order (§13) | **adopt** as an 11th MCP tool, LSP-first with a fallback to our index | rule 40, `context/symbolPack.ts` |
| "WHEN:" tool descriptions (§13) | **adopt** | PATTERNS P4 |
| Loopback-only, bounded MCP server (§14) | **adopt**: loopback remote-address check plus the bound | workflow 02 |
| Instruction files and skill triggers (§8) | **adopt**: the same instruction file list, skills with globs/keywords/alwaysApply, `<skills_index>` + `<active_skills>` | rule 85 |
| Voice, computer use, browser, Battle-like multitask, cloud index, ACP host | **skip**: out of scope (rule 00) | — |

