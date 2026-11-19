---
description: Final pre-recording and pre-submission check - eligibility gate, scoring rows, safety laws, secrets, links
argument-hint: ""
---

# Release check

Run this after the feature freeze (rule 95), before recording, and once more before submitting. Every line needs
evidence: command output or a timestamp in the video.

## Eligibility gate (any ✗ means stop and fix)

- [ ] Every turn goes through TrueForge (`grep -rn "createTurnStream" packages/agent-core/src` hits `forge/turn.ts` only).
- [ ] No provider calls: `node scripts/check-invariants.mjs` passes, and
  `grep -rnE "integrate\.api\.nvidia|generativelanguage|openrouter\.ai|api\.openai\.com" packages extensions` is empty.
- [ ] The editor tools are MCP: the status bar shows `TF ✓ 10 tools`.
- [ ] `agents/co4fe3-coder.agent.json` and `agents/co4fe3-inline.agent.json` are committed and match what the
  extension sends (the `buildSpec` test).
- [ ] TrueForge runs in local mode from `npm run trueforge` (pinned version).

## Scoring rows (each one is seen working in the last rehearsal)

- [ ] A1: per-hunk ✓/✗ in the diff editor (lenses or title buttons).
- [ ] A2: Task B edits 3+ files nobody named.
- [ ] A3: Stop is instant; `git status` is clean after Stop.
- [ ] B1: the pack card shows files, reasons and `used/budget`; the lead's Plan/Files message.
- [ ] B2: Undo restores exact bytes, shown on screen.
- [ ] B3: the automatic fallback banner appears with no user action; `git status` clean.
- [ ] B4: approval drives the review; subagent threads are visible in the TrueForge session; tools preloaded on
  purpose; compaction configured.
- [ ] C1: the video is ≤ 4:00, in A → B → C order, with verifications legible.
- [ ] C2: the write-up's 8 headings in order, the scorecard with real timestamps, and honest limitations.

## Safety laws

- [ ] `npm run verify` is green on the commit being submitted.
- [ ] The secrets audit (workflow 12) printed nothing.
- [ ] `.env` and `config/providers.json` are not tracked (`git ls-files | grep -E "^\.env$|providers\.json$"` is empty).

## Links

- [ ] All three open in a private window.
