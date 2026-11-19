---
name: orchestrate
description: Coordinate multi-file or multi-unknown work - split into independently verifiable units, scout in parallel, edit serially, verify between units, review once
argument-hint: "<task>"
agent: forge-oracle
triggers:
  - user
  - model
---

Orchestrate: $ARGUMENTS

## Pattern

```
scouts (parallel, ≤ 3) → plan → editor (serial, one unit at a time) → verifier after EVERY unit → reviewer once at the end
```

## Decomposition rule

Each unit names its files (≤ 2) and its check. If two units would fail together, they are one unit. Pure agent-core
units come before the extension wiring that uses them.

## Example plan (task: "workflow 08, automatic fallback")

```
PLAN
U1 — agent-core/src/forge/fallback.ts, test/fallback.test.ts — editor — npx vitest run packages/agent-core/test/fallback.test.ts
U2 — agent-core/src/forge/attempt.ts, test/integration/fallback.test.ts — editor — npx vitest run --project integration test/integration/fallback.test.ts
U3 — extensions/…/src/forge/router.ts, forge/sessions.ts — editor — npm run verify:fast + Extension Development Host: Task C checklist
U4 — extensions/…/src/inline/inlineEdit.ts (banner wiring), docs/CODEMAP.md — editor — npm run verify
Order: U1 → U2 → U3 → U4. Reviewer once after U4.
```

## Output contract

```
PLAN
<unit> — <files> — <profile> — <how verified>
RESULT
<per unit: changed / checked / outcome>
SYNTHESIS
<what now holds, what does not, what was deferred and where>
VERIFY: <final gate line>
```

## Hard limits

- At most 4 units per plan; more means cutting scope and saying what was cut.
- Never skip the verifier between an editor unit and the next one.
- Report a failed unit as failed. Never drop it silently.
