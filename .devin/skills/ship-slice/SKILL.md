---
name: ship-slice
description: Implement one slice (max 2 files) with co4fe3's laws enforced - the single writer, vscode-free core, TrueForge-only model access, untrusted model text, budgets
argument-hint: "<slice description>"
agent: forge-editor
triggers:
  - user
  - model
---

Ship this slice: $ARGUMENTS

## Before writing (one line each, in your reply)

- The box: GOAL / FILES (≤ 2, layer) / PATTERN / CHECK
- The laws touched, and how this slice keeps each one
- Any new export: its exact signature, which goes into CODEMAP in the same commit

## Then

1. Read the target files in full.
2. Write the test first when the code is pure (agent-core): a failing test, then the code.
3. Make the smallest change. No drive-by formatting or renames.
4. `npm run typecheck`, then `npm run verify:fast`.
5. For anything user-visible, open the Extension Development Host and watch it once.
6. Report with the editor contract (the `forge-editor` profile).

## The eight things that break co4fe3 (check ALL before you report)

1. A file written anywhere except `review/apply.ts`, or written before every hunk is decided.
2. `import … from "vscode"`, `child_process` or an fs write inside `packages/agent-core`.
3. A provider URL, a provider SDK or a model name in code (they belong in TrueForge config and
   `providers.example.json`).
4. A TrueForge POST with default retries (`maxRetries` must be 0), or a stream without the 600 s timeout.
5. Model text trusted as an instruction or rendered as HTML (`dangerouslySetInnerHTML`, `innerHTML`, `eval`).
6. A tool result or prompt piece without its cap (rule 40 budgets), or a path that skipped `jail()`.
7. An `await` on the activation path, or a synchronous loop over the whole workspace on the UI thread.
8. A fallback retry after `sideEffects` became true, or a retry with `previousTurnId: "auto"`.
