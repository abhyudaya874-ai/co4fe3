# 07 — crew (modes, profiles, evidence, board, watchdog)

## Built

- `buildSpec` rewritten to the workflow-07 spec: `MODE_TAIL` verbatim (ask/plan), `enableTools` is `["@all"]` in
  agent and `toolsForMode` elsewhere, `requireApprovalForTools` always overrides the file's list (`[]` in ask/plan —
  the file's own gated list could otherwise leak), `crew === false` disables `dynamicSubAgents` only, and the
  compaction trigger is `floor(contextLength * 0.6)`. No `$` placeholder survives (spec.test.ts).
- `Crew` (`extensions/…/panel/crew.ts`): `onEvent` now folds `crewWatch` and returns the watchdog's stop sentence;
  `reset(mode)` runs at every `send()` so members and the cap count belong to one request (caps are per-request).
  `thread.done` pushes the evidence-checked verdict with the profile intact.
- `AgentTurns`: `crew.reset(mode)` per turn; on a watchdog stop it pushes `{kind:"marker"}` and aborts via the same
  Stop path. A `toolCallId → name` map detects `board_write` responses and pushes `{kind:"board"}` so the board card
  updates live (`board` is now a turn dep).
- Message rows use member **titles** (`lead → Find CLI registration`), matching `thread.created/done.title`.
- `SessionPool.agent` passed `mode` through to the spec factory (was hardcoded `"agent"` — ask/plan would have
  shipped agent tools). The extension factory now maps `inline → agent` (its file has no `$EDITOR`, so no tools)
  and passes the real mode otherwise.
- Webview: `board` rows render (`BoardCard` was orphaned); briefs/reports collapse after 3 lines; `waiting-approval`
  pulses; `blocked` shows its reason.
- `commandPolicy` regex fixed: `rm -rf ~/x` (and `/path`) are now denied — the old `(\s|$)` tail let `~`-paths
  through.

## Tests

- `spec.test.ts`: placeholders filled, agent keeps `@all` + both gated tools, ask/plan read-only + `[]` gate +
  mode tail, crew flag semantics, compaction trigger, no-server → no tools.
- `evidence.test.ts`: work-member blocked on claimed-but-unaccepted edits, completed with one accepted hunk,
  research never blocked, all-rejected blocked with reason, failed → failed.
- `crewpolicy.test.ts`: the `commandPolicy` table (11 denials + 6 allows) and `crewWatch` stopping at member 9.
- `integration/crew.test.ts` (real TrueForge + fake model): lead → `create_sub_agent {name, input}` with a
  `PROFILE: research` brief → member's `propose_edit` **denied** at the pause with the profile reason (verified in
  the member's next request) → member reports → `member(running) → to- → member(completed) → from-` in order, and
  `applier.log` stayed empty (zero writes).

## Notes for the write-up

- TrueForge does apply `tool.approval_required` pauses to member threads: the deny reached the member as its tool
  result and it adapted (reported instead of editing). Verified, not assumed.
- `requireApprovalForTools: []` in ask/plan: sent as an empty list (the workflow's recipe). Sessions create fine
  under it (agent mode exercised end to end); no rejection observed in integration.
- Real Task B run with a real model is still pending (HUMAN CHECK): member count/titles/durations, "Plan / Files"
  first message, pack_context vs read_file counts, propose_edit count, pytest, and the Plan-mode run. Record
  them here before the video.

## Verification

`npm run verify` — typecheck, unit (144 tests incl. new spec/evidence/crewpolicy), perf, integration (incl.
`crew.test.ts`), e2e: all green at commit time.
