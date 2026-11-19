# 05 agent panel

## Exit check
- [x] `reducer.test.ts`, `coalesce.test.ts`, `fromForge.test.ts` green (snapshots keyed by id, 33 ms coalescing, the full event mapping)
- [x] integration `approval.test.ts` green: fake model calls `propose_edit` → `tool.approval_required` pauses the turn → the review accepts → the file is written → `createTurnEvents` resumes → `turn.done`
- [x] integration `cancel.test.ts` green: Stop while a review is pending → the review rejects on abort → turn cancelled, no write
- [ ] HUMAN CHECK: F5 → panel visible, send a task, watch streaming text, tool cards, member rows, proposal cards, Stop, "Open session in TrueForge"
- [x] Commit: `panel: streaming agent panel with review cards and instant stop` (7c45cdc)

## Raw output

```
npm run verify → all stages passed (pending: perf)
  unit · integration ok (approval + cancel) · build ok · e2e ok (18.0 s)
```

What was built:

- `panel/events.ts` — the PanelEvent union: user/text/reasoning snapshots, tool running/ok/error, member status,
  briefs/reports, context pack, instructions, proposals with per-hunk verdicts, commands, approval, board, markers
  (compaction, model switch), model notes, latency, status (incl. the session URL).
- `panel/reducer.ts` + `panel/coalesce.ts` — the pure store; 33 ms batches, a newer snapshot replaces the older.
- `forge/events.ts` + `forge/fromForge.ts` — TrueForge event → PanelEvent mapping (the only place wire shapes live).
- `panel/pause.ts` — the review gate: validates `propose_edit` args, jails paths, computes before/after + hunks,
  stages the review, waits for verdicts; all-rejected → the tool call is denied; `sideEffect` set only after approval.
- `panel/agentTurn.ts` — the turn driver: creates the turn stream, feeds events through fromForge → bridge → panel,
  answers approval pauses through pause.ts, Stop aborts at once.
- `panel/crew.ts` — `thread.created`/`thread.done` → member rows + brief/report cards.
- `panel/bridge.ts` + `panel/panelView.ts` — 33 ms batching into the webview; `UiCommand`s back (send, stop, approve,
  verdicts).
- `crew/evidence.ts`, `forge/fallback.ts` (rule 70's code, switched on in 08), `context/pack.ts` types,
  `context/mentions.ts`, `instructions/{frontmatter,load}.ts` (rule 85 loaders used by the panel's cards).
- Webview: `App.tsx` (memo rows, transcript, header with Stop + session link), `md.tsx`, `main.css`.

Findings recorded along the way:

- The harness's `onReview` now accepts sync or async; its review rejects on abort, matching the product's `settled()`.
- `propose_edit`'s wire schema is snake_case (`old_string`/`new_string`); a camelCase test sent malformed args and the
  deny path "cancelled" instantly — the test was asserting the wrong thing until the args were fixed.
- The e2e fixture leaked: the test's `BEFORE` differed from the committed fixture by one quote, so every green run
  left `minipkg/helpers.py` dirty, and workspace settings left `.vscode/settings.json` behind. `BEFORE` now matches
  the fixture byte-for-byte, teardown clears `trueforge.url`, and `test/fixtures/minipkg/.vscode/` is ignored.

EXIT: passed (Fri ~00:20) · AWAITING HUMAN: the panel beats on screen (stream, tool cards, proposal cards, Stop, session link)
