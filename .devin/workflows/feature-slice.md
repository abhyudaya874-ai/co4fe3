---
description: Build one slice end to end - map, declare, build, gate, review, land
argument-hint: "<slice>"
---

# Feature slice: $ARGUMENTS

## Phase 1: map

Run `/explore-codemap` on the entry point, even when it looks obvious. The obvious slice is where a law gets missed
(the single writer, no vscode in core, never trust model text, never copy V3Code code). If the slice is new design,
read its section of `docs/study/v3code.md` first.

## Phase 2: declare (4 lines, in your reply)

```
GOAL / FILES (max 2, layer) / PATTERN (docs/PATTERNS.md) / CHECK (command)
```

More than 2 files? Run `/orchestrate` instead.

## Phase 3: build

Run `/ship-slice`. Check the nine things that break co4fe3 (listed in that skill) before you report.

## Phase 4: gate

`npm run verify:fast` after each edit, and `npm run verify` at the end. Red is red: never proceed on a known failure.
For anything user-visible, also watch it once in the Extension Development Host.

## Phase 5: review

Run `/review-diff`. A `rework` verdict sends you back to Phase 2, not Phase 3.

## Phase 6: land

Commit in house format (rule 95). Add anything deferred to `docs/BACKLOG.md`.

## Worked example: "show the model that answered in each diff card"

```
GOAL:    each proposal card in the panel shows "by <member> · <model>"
FILES:   agent-core/src/panel/events.ts (add `model` to the proposal event), webview/src/components/DiffCard.tsx
PATTERN: P9 "Add a field to a PanelEvent" (docs/PATTERNS.md)
CHECK:   npm run verify:fast, then open a proposal in the Extension Development Host
```

Build: add `model?: string` to the `proposal` PanelEvent. `pause.ts` sets it from `router.currentModel()`.
`DiffCard` renders it after `by`. Gate: the reducer test still passes and a new test asserts the field survives a
replace. Commit: `panel: show the answering model on diff cards` / Why: makes Task C's fallback visible on B
proposals too / Files: 2.
