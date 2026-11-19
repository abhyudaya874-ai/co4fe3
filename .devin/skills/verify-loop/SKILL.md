---
name: verify-loop
description: Run the gate, read failures top-down, fix code not checks, and stop after two strikes
argument-hint: "[fast|full|live]"
agent: forge-verifier
triggers:
  - user
  - model
---

Verify: $ARGUMENTS (default: fast after an edit, full before a commit)

## Loop

1. Run `npm run verify:fast`, `npm run verify` or `npm run verify:live`.
2. On a red result, read the **first** failing stage only. Fix it, then re-run. Later failures are often caused by
   the first.
3. Map each stage to its kind of fix:

| Stage | Typical cause | Fix in |
|---|---|---|
| invariants | a law broken (a write outside apply.ts, vscode in core, a provider host) | the code that broke it; the message names the file and line |
| typecheck | an invented name, a wrong SDK field casing | look the name up (CODEMAP / `.d.ts`) |
| unit | a logic error, or a test that pins a rule | the code; if the rule is wrong, fix the rule first, in its own commit |
| perf | a slow pure function | the algorithm (never raise the threshold) |
| integration | the TrueForge contract or wiring | rule 20 + spike record, then the code |
| build / e2e | the manifest, a bundling externals issue, the webview file names | `package.json`, `esbuild.mjs`, `vite.config.ts` |

4. Two strikes on the same failure → stop, write *tried / saw / now suspect*, ask.

## Never

- Edit `scripts/check-invariants.mjs`, a test or a hook to get green.
- Skip a stage, or commit after `verify:fast` only. The commit hook checks the full verify stamp.
- Report green without pasting the final line `verify: all stages passed`.
