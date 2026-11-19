# ANTI-PATTERNS (wrong → right). Scan before reporting done.

| # | Wrong | Right | Why |
|---|---|---|---|
| 1 | `fetch("https://integrate.api.nvidia.com/v1/chat/completions", …)` in the extension | a TrueForge session with the model configured in TrueForge | eligibility gate; law 1 |
| 2 | `import * as vscode from "vscode"` in `packages/agent-core` | an injected `EditorHost` / `Applier` | law 2; the core is reused by the co4fe3 app (V3Code fork) |
| 3 | `await vscode.workspace.applyEdit(edit)` in `inlineEdit.ts` | `applyDecision(applier, proposal, decision)` | law 3: one writer, one checkpoint log |
| 4 | applying hunks as the user clicks each ✓ | collect the verdicts; write once when no hunk is pending | a half-reviewed file never exists on disk |
| 5 | `propose_edit` writes when called | it writes only the decision taken from `ReviewStore` by key | law 4; no decision = no write |
| 6 | approving `propose_edit`, then computing hunks in the handler from fresh text | hunks computed once at review time; the handler re-checks `before` and returns a conflict if it changed | the user approved exactly what is written |
| 7 | `client.sessions.createTurnStream(id, body)` | `…(id, body, { ...STREAM, abortSignal })` | 60 s default timeout; 2 default retries create duplicate turns |
| 8 | `break` out of the stream after `cancel()` | abort our read via `abortSignal`, and let the server's `turn.done` arrive if it does | rule 20, trap 5 |
| 9 | retrying a failed turn with `previousTurnId: "auto"` | `previousTurnId: failed.previousTurnId ?? "none"` | "auto" chains onto the failed turn and duplicates the user message |
| 10 | a fallback retry after an approved edit | `sideEffects` stops automatic retries; offer "Retry on <model>" | a retry could re-apply work |
| 11 | `sessions.create({ agent: { name: "co4fe3-coder" } })` | an inline `spec` from `buildSpec()` | named sessions reject `update`, so no model switch is possible |
| 12 | `mcp_servers`, `require_approval_for_tools` in a TS spec | `mcpServers`, `requireApprovalForTools` | the TS SDK is camelCase; the wire format is snake_case |
| 13 | relying on `@write` / `@destructive` to gate our tools | literal names: `["propose_edit", "run_command"]` | annotations only match labelled tools |
| 14 | `preload: false` (the default) on our editor server | `preload: true` | deferred discovery costs extra model round trips per tool |
| 15 | an inline edit through a tool loop | one streamed fenced block, diffed locally | one round trip instead of two or more |
| 16 | `dangerouslySetInnerHTML={{ __html: marked(text) }}` | `md.tsx` React elements, or `<pre>` | model text is untrusted data |
| 17 | the whole transcript posted to the webview on every delta | coalesced 33 ms batches of id-keyed snapshots | rendering stays under 50 ms |
| 18 | `await indexWorkspace()` inside `activate()` | `void indexWorkspaceInBackground(...)`, chunked with `setImmediate` | activation < 150 ms; the editor never blocks |
| 19 | `child_process.exec(model.command)` without a policy, timeout or cap | `commandPolicy` → TrueForge approval → `runCapped` (timeout, cap, kill tree, no key env vars) | safety and a consistent Stop |
| 20 | `read_file` on `.env` or `../../secrets` | `jail()` refuses secrets and paths outside the root | the model would see keys |
| 21 | special-casing `flask`, `cli.py` or the Task B wording in ranking or prompts | generic weights and generic tool descriptions | judges may use another repo and another model |
| 22 | hard-coding `"nvidia-nim/nemotron-super"` in TypeScript | `co4fe3.models.order`, read from config, with the list from TrueForge | there is no single provider |
| 23 | `catch (e) { /* ignore */ }` around a model call | classify → bench → note → banner | Task C must show a clear message |
| 24 | a stack trace in a toast | `failureLine(model, failure)`, with the raw error redacted in the output channel | rule 70 |
| 25 | a test that sleeps 2 s waiting for a stream | the fake model script plus awaited events; fake timers for delays | flaky tests waste the timebox |
| 26 | `it.skip("cancel works")` | fix it, or a BACKLOG line naming the test and why | a skipped test is a hidden failure |
| 27 | `npm i some-lib` | `npm i --save-exact some-lib@x.y.z`, with the reason in the commit body | reproducible clean clone |
| 28 | a key in `config/providers.json` | `${NVIDIA_API_KEY}` placeholders, filled from the environment at setup | law 7 |
| 29 | a crew member messaging another member | brief down, report up; shared facts on the board | UltraPals rule; prevents chatter loops |
| 30 | adding Battle/Loop/judge modes "because UltraPals had them" | not in scope | rule 00 non-goals |
| 31 | pasting a V3Code/Void function "because it already works" | close the file; write a test from the idea; write our own code; credit it in D19 | rule 05: one declared fork point ("from scratch"); hooks block their headers |
| 32 | a weighted score blend (`0.6 * pr + 0.4 * lex`) | `rrfMerge` over ranked channels, k = 60 | uncalibrated weights; RRF tolerates missing channels and explains itself (D8) |
| 33 | awaiting retrieval with no limit before sending | `withinBudget(full, quick, none)` | a cold index must never delay the first token (V3Code `retrieveBudget`) |
| 34 | two `propose_edit` reviews for one file in one pause | review the first, deny the rest with the "same step" sentence | the handlers may run in any order; the second would conflict (D21) |
| 35 | a member row turns `completed` because `thread.done` said so | `assessMemberOutcome` on the member's own evidence | a report can claim edits that never happened (V3Code `assessWorkerOutcome`) |
| 36 | Ask mode enforced only by telling the model "do not edit" | `enableTools = toolsForMode("ask")`, plus the pause gate | the advertised list must equal the gate (V3Code `availableTools`) |
| 37 | `if (count > 2) refuse` scattered in handlers | `TurnPolicy.before/after` in `wrap()` | one policy object, decisions only, tested alone (V3Code `localAgentRuntime`) |
| 38 | "the file has 14 errors" after an edit | `newErrors(baseline, after)`: only errors this edit introduced | most files already have problems; only new ones are actionable (V3Code `turboDraftVerify`) |
| 39 | an idle timer that fires while the user reads a diff | pause the idle watchdog during `onPause` | a person reviewing is not a stall |
| 40 | `…` truncation with no hint | `truncateWithHint(text, max, "call read_file with offset=…")` | the model must know how to get the rest |

