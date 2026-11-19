# 03 review-core

The pure core (lines, hunks, edits, store, checkpoints, verify, jail, stable) was pulled forward into workflow 02's
commit, because the `propose_edit` handler needs it; its tests shipped there too. This workflow built the extension
side: the single writer, the proposal diff editor, per-hunk CodeLens, the controller, and the commands.

## Exit check
- [x] Unit: `hunks` (property), `edits` (every `EditReject` reason), `store` (`settled` resolves only when nothing is
  pending; `take` is one-shot; `dropTurn`), `checkpoints`, `verify`, `previewLines` — all green (57 unit tests total)
- [ ] HUMAN CHECK (Extension Development Host, on `test/fixtures/minipkg/src/minipkg/helpers.py`):
  1. Run the dev command `co4fe3.dev.sampleProposal` (command palette, Development mode only). The diff shows 3 hunks with lenses.
  2. Accept h1, reject h2, accept h3. The file has exactly h1 and h3, and is saved.
  3. Undo (`co4fe3.undoLast` or the toast button). The file is byte-identical to before (`git diff --stat` is empty).
  4. Record a 10-second screen capture of steps 2–3 into `docs/progress/03-review.md` (it is the B2 evidence).
- [x] Commit: `review: per-hunk diff review, single writer, checkpoints and undo`

## Raw output

```
npm run verify → all stages passed (pending: perf, e2e)
  unit: 11 files, 57 tests (hunks property test with fast-check included)
  build ok · invariants ok · hooks 36/36
```

What was built here (extension side):

- `review/apply.ts` — `createApplier` (the ONLY writer: conflict check → one WorkspaceEdit → one save → checkpoint)
  plus `applyDecision` (P6) and `saveCheckpoints` (the checkpoint log's persistence; it lives in this file because
  the hook enforces law 3's letter: `workspace.fs.writeFile` appears only here).
- `review/proposalDocs.ts` — the `co4fe3-proposal` content provider; the right side shows pending + accepted hunks.
- `review/hunkLens.ts` — ✓/✗ CodeLens on every pending hunk (needs `diffEditor.codeLens`, contributed as a default).
- `review/controller.ts` — `review()` stages, opens the diff, awaits `settled`; on abort it closes the tabs and drops
  the proposal. `preview()`/`closeStreaming()` serve workflow 04's inline streaming.
- `extension.ts` — commands: hunk accept/reject, accept/reject at cursor (Alt+Y/Alt+N), accept/reject all (editor
  title), undoLast (toast button + status item), revertTurn, and the dev sample proposal.
- `util/queue.ts` — `KeyedQueue`: one write at a time per path.

Notes:

- The dev command's proposal is planned with `planEdit` against the whole buffer, so the hunks are exactly the three
  sample changes; the apply goes through `applyDecision`, the same path a real proposal takes.
- Checkpoint persistence uses `ctx.storageUri/checkpoints.json` via `saveCheckpoints` in apply.ts.

EXIT: passed (22:12) · AWAITING HUMAN: the 4-step Extension-Dev-Host demo + the 10-second capture
