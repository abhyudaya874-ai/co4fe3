# 08 — models and fallback (Task C machinery)

## Providers (registered on http://localhost:8790 via `npm run setup:trueforge`)

TrueForge now serves (FQNs, from `client.models.list()`):

- `nvidia-nim/nemotron-super` — modelId `nvidia/nemotron-3.5-super-vl-120b-a12b`, ctx 131072
- `nvidia-nim/nemotron-ultra` — modelId `nvidia/nemotron-3-ultra-550b-a55b`, ctx 131072
- `google-gemini/gemini-flash-lite` — modelId `gemini-3.5-flash-lite`, ctx 1048576

`co4fe3.models.order` default: `["nvidia-nim/nemotron-super","google-gemini/gemini-flash-lite"]`
(also what an unset order resolves to — the extension takes the first two `models.list` entries).
Setup prints a warning per model: "Reasoning effort is not configured" — recorded for the write-up.

## Built

- `latency/stats.ts` — ModelStat, record(), percentile, orderModels (benched filter + p50 reorder for inline),
  hedgeDelayMs, stallMs, IDLE_STALL_MS (rule 60 verbatim).
- `forge/attempt.ts` — `attemptTurn`: runTurn + first-token watchdog (`stallMs`) + post-token idle watchdog
  (default 45 s, rearmed on EVERY event, **cleared while a review waits for the user**). A stall aborts the attempt
  and reports `cancelled/stall`; `sideEffects` flips on the first approved call. `firstTokenMs` feeds the stats.
- `forge/fallback.ts` — already complete (classifyFailure table, retryAfterMs, backoffMs, runWithFallback).
- `forge/messages.ts` — `failureLine`, `noteLine`, `allFailedLine`, `fallbackBanner`.
- `Router` (extension) — stats in `globalState["co4fe3.stats.v1"]`, `order()` = user order minus benched
  (all-benched → user's order anyway), `inline()` = runWithFallback over pre-warmed per-model sessions
  (`previousTurnId: "none"`), `agent()` = same machine on the chat session via `sessions.update` for the model
  swap and `previousTurnId` chaining on retry (rule 20 trap 7). Failure kinds bench the model (`record`).
- UX — "Waiting for <model>… <n> s" progress line; `⚠ <failure line> Answered by <fallback>.` warning on fallback;
  all-failed → error with [Retry] [Open TrueForge settings]; status-bar model item shows ⚠ + tooltip while the
  primary is benched; `co4fe3.pickModel` (two QuickPicks with p50/ok/failed/benched descriptions → models.order);
  `co4fe3.resetStats`; panel `{kind:"model"}` note rows in the transcript.

## Tests

- `stats.test.ts` (6), `fallback.test.ts` (20 — spike strings `HTTP 403: Forbidden`, `Cannot connect to API: bad
  port` classify as auth/unreachable), `attempt.test.ts` (4 — no-events stall, post-token stall, a 5×idle pause is
  NOT a stall, steady stream done).
- `integration/fallback.test.ts` (2, real TrueForge + two fake providers):
  - primary `{fail:401}` → `attempt(A) → failed(A,auth) → attempt(B) → answered(B, fellBack)`; files unchanged;
  - primary `{hang:true}`, `stallMs:1500` → same note order with `stall`, fallback in ~1.5 s.

## Banner wording (verbatim, for the write-up)

- Fallback: `⚠ nvidia-nim/nemotron-super rejected the API key (HTTP 403: Forbidden). Fix it in TrueForge →
  Settings → Models. Answered by google-gemini/gemini-flash-lite.`
- All failed: `No configured model answered. nemotron-super: HTTP 403: Forbidden · gemini-flash-lite: rate-limited
  (61 s). Nothing was changed.` + buttons `[Retry] [Open TrueForge settings]`
- Waiting: `Waiting for nvidia-nim/nemotron-super… 3 s`

## Task C rehearsal — PENDING THE HUMAN

Checklist (rule 70 §"Task C checklist") runs twice in the Dev Host: break nvidia-nim's key in TrueForge Settings →
Models, repeat Task A, expect the banner + streamed diff + clean `git status`, optionally break the fallback too.
Then `npm run setup:trueforge` restores the key and `co4fe3: Reset model stats` unbenches the primary.
