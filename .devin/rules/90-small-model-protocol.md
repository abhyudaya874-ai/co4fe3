---
trigger: always_on
description: How to work reliably as a small model - tiny slices, look names up, copy patterns, verify after every edit, stop after two failed attempts
---

# Small-model protocol

You are a small, fast model. You are good at following a recipe and bad at inventing architecture.
So: **never invent. Look up, copy, adapt, verify.**

## The 8 habits

1. **One slice at a time.** ≤ 2 files, ≤ 80 changed lines. If the task is bigger, say so and split it.
2. **Look names up; never guess them.**
   - Our names are in `docs/CODEMAP.md`.
   - TrueForge names are in rule 20, and anything else in `node_modules/@truefoundry/trueforge-sdk/dist/cjs/api/**/*.d.ts`.
   - VS Code names are in `node_modules/@types/vscode/index.d.ts`.
   - MCP names are in `node_modules/@modelcontextprotocol/sdk/dist/esm/server/*.d.ts`.
   - Design questions ("how should X work?") are answered in `docs/study/v3code.md` first. V3Code shows the shape;
     our CODEMAP gives the names. Never import or paste a V3Code name or file (rule 05).
   - If grep finds nothing, the name does not exist. Create it deliberately and add it to CODEMAP in the same commit.
3. **Copy a pattern.** Find the recipe in `docs/PATTERNS.md` and adapt it. Do not design a new shape for an old problem.
4. **Read the whole file before editing it.** A search hit out of context is a guess.
5. **Types are your safety net.** Use discriminated unions, exhaustive `switch` with `assertNever`, and
   `Record<Kind, …>`. Run `npm run typecheck` right after an edit and fix errors top-down (the first error often causes the rest).
6. **Verify after EVERY edit** with `npm run verify:fast` (≈15 s). Run `npm run verify` before a commit. For anything a
   judge sees, also press F5 and watch it in the Extension Development Host.
7. **Never "fix" a check.** If `check-invariants.mjs`, a test or a hook fails, fix the CODE. If you believe the check
   is wrong, stop and say why.
8. **Two strikes, then stop.** Same error twice → write *tried / saw / now suspect* (3 lines), then re-plan or ask.

## Before you write code, fill in this box (in your reply, 4 lines)

```
GOAL:      <one sentence>
FILES:     <paths, max 2>   (layer: core | extension | webview | test)
PATTERN:   <name of the recipe in docs/PATTERNS.md>
CHECK:     <the exact command that proves it works>
```

If you cannot fill `PATTERN`, you do not understand the task yet: run `/explore-codemap` first.

## Before you say "done": the 7-point self-review

1. `npm run verify` printed `verify: all stages passed` (not "should pass").
2. I touched ≤ 2 files (3 only with a stated reason).
3. The laws hold:
   - no `vscode` import in agent-core;
   - every write goes through `apply.ts`;
   - no provider host or SDK;
   - no key in any file.
4. There is no `any`, `@ts-ignore`, `eslint-disable`, commented-out code or `console.log` (use the `LogOutputChannel`).
5. Every new export is in `docs/CODEMAP.md` with its exact signature. Every new setting is in `package.json`, `readConfig()` and CODEMAP.
6. I scanned `docs/ANTI-PATTERNS.md` and none apply.
7. I can name the demo beat this serves (A, B, C or a scoring row). If I cannot, it belongs in `docs/BACKLOG.md`.

## Decision tree

| Situation | Do this |
|---|---|
| tsc error mentions a name I do not recognise | grep CODEMAP, then the repo, then the `.d.ts`. Never add `any`. |
| TrueForge behaves differently from rule 20 | Record the exact event sequence in `docs/progress/01-spike.md`, fix rule 20 **and** the code in the same commit. |
| I am designing something the rules do not cover | Check `docs/study/v3code.md` §15 for how V3Code did it. Adopt or adapt its idea in our own code, and add a D19 line. |
| A V3Code file has exactly the code I need | Close it. Write the idea as a test, then our own code. The hooks block pasted V3Code/Void headers. |
| A test fails and I think the test is wrong | Re-read the rule it cites. The rule wins. If the rule is wrong, fix the rule first, in its own commit. |
| I need a new dependency | Stop. Is it already in a `package.json`? If not, say why, its size and its licence, and ask. Pin it exactly. |
| I want to refactor "while I'm here" | No. Write it in `docs/BACKLOG.md`. |
| A hook blocked me | Read its message. It says what to do. Do that. |
| Something must be written to a workspace file | It goes through `Applier.apply`. There is no second way. |
| A UI step feels slow | Measure first (`Marks`, `perf` lines), then use a lever from rule 60. Never guess. |
| The task contradicts a rule | Stop and ask. Rules win over tasks. |

## Output style

Short and exact. Findings as `path:line — what`. No preamble, no apology, no recap of the task.
Report the commands you ACTUALLY ran and what they ACTUALLY printed.
