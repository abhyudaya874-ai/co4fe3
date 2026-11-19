# 04 inline

## Exit check
- [x] `inline.test.ts` green (13 tests: fence, streaming preview, assembly, prompt budget, phase machine)
- [x] the e2e `inline.test` green (the scripted fake model drives the same command):
  ```
  ✔ streams a diff, accept writes the hunk, undo restores the bytes (2563ms)
  ✔ the extension activates and its commands answer
  2 passing (10s)
  ```
  The e2e boots its own throwaway TrueForge when :8790 is down (same pinned build, temp SQLite), registers the
  scripted provider, waits for the extension's MCP registration, then drives: fire `co4fe3.inlineEdit` → the diff
  tab opens → CodeLens appear (proposal staged) → `proposal.acceptAll` → the file changed → `undoLast` → bytes
  restored. It cleans up the provider and the instance.
- [ ] HUMAN CHECK: steps 1–7 on flask (`.cache/flask`, config "Run co4fe3 on flask") — the Task A beats:
  accept, Undo, Stop mid-stream ("Cancelled. Nothing was changed.", `git status` clean), typing during the stream
  (ends `sourceChanged`, nothing written). Needs TrueForge on :8790 and the real models.
- [x] Commit: `inline: streamed inline edit with per-hunk review and undo`

## Raw output

```
npm run verify → all stages passed (pending: perf)
  unit 14 files / 70 tests · integration ok · build ok · e2e ok (15.7 s)
```

What was built:

- `review/inline.ts` — `extractFence`, `streamingPreview`, `assembleInline`, `buildInlinePrompt` (40→20→10→0
  context trim, problems dropped before context), `InlinePhase` + `canAdvance` + `PhaseBox`.
- `forge/spec.ts` — `buildSpec` + `MODE_TAIL`; the inline agent gets **no tools** (one model call, rule 60 lever 1).
- `forge/sessions.ts` — `SessionPool` (one spare session per mode+model, created while the user types).
- `forge/router.ts` — `Router.inline` (one model, no fallback yet; 08 adds it), `order`, `label`, `lastModel`.
- `latency/marks.ts` — the per-turn timings; the output channel logs `perf ttft=… created=… total=… model=…`.
- `inline/inlineEdit.ts` — the Ctrl+Alt+K command: selection → whole lines (empty → enclosing def/class), pre-warm,
  input box (an `{ instruction }` argument skips it — the e2e seam), streaming into the diff, phase box,
  sourceChanged detection, the same per-hunk review, verify-after-apply, toast with Undo.
- `extension.ts` — the client re-reads `co4fe3.trueforge.url` (a change re-registers the MCP server); the editor
  title accept/reject buttons take the doc's uri, falling back to the newest proposal.

Findings recorded along the way:

- The e2e initially deadlocked: the command resolves only after the review, so the test must drive the review while
  it runs, and must wait for the CodeLens (the proposal is staged ~1 s after the tab opens).
- `acceptAll` now takes the doc uri (the editor-title menu passes it) and falls back to the newest proposal.
- The extension host's fetch reaches `localhost`/`::1` fine; `127.0.0.1` is refused by TrueForge's bind (rule 20).

EXIT: passed (23:12) · AWAITING HUMAN: the flask beats (steps 1–7) on screen
