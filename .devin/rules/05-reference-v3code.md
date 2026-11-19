---
trigger: always_on
description: How to use /home/de3p/V3Code as the reference architecture - read it, reimplement the idea, never copy its code, credit it
---

# V3Code is the reference architecture (read it, never copy it)

`/home/de3p/V3Code` (github.com/HeavenFYouMissed/V3Code, read at commit `2eac91fb`) is an Apache-2.0 AI code
editor built on Void and Code-OSS. co4fe3 follows its architecture where the VS Code **extension** API allows it.
`docs/study/v3code.md` maps every idea we use to its V3Code file, and §15 of it says what we adopt, adapt or skip.
Read that file before you design anything in rules 30, 40, 50, 60, 70 or 85.

## Why "never copy" (hard rule)

1. The Forge-a-thon allows only one declared fork. Our fork point is "from scratch", and judges read our git
   history. Pasting V3Code or Void code would be undeclared reuse.
2. V3Code's own `AGENTS.md` requires recording the source, commit, path and licence for any copied code, and
   keeping every existing notice. We do not want that burden in a two-day build.
3. Most of V3Code needs workbench internals (Monaco view zones, React inside the workbench, the Rust sidecar)
   that an extension cannot use. Copying would not even compile.

So the procedure for an idea is always the same:

```
1. Find it in docs/study/v3code.md (or grep V3Code for it, read-only).
2. Read the V3Code file to understand the idea. Close it.
3. Write the rule/test in OUR words, then OUR code that passes it. Names are ours (no Void*/V3Code* names).
4. Credit the idea in docs/DECISIONS.md (D19) and, if new, in docs/study/v3code.md §15.
```

Numbers that are design parameters (RRF k = 60, repeat thresholds 3/5, pack_context caps) may be reused, credited.
They are facts about a design, not code.

## Hooks and checks that enforce this

- `guard-write.sh` blocks any write into `/home/de3p/V3Code`, and any write whose content carries a V3Code or
  Void licence header (`KandD Labs`, `Glass Devtools`, "Part of V3Code").
- `check-invariants.mjs` fails if `packages/` or `extensions/` contain those headers, or a `void`/`V3Code`
  identifier in an exported name.

## Reading V3Code

The repo is outside the workspace, so workspace search tools cannot see it. Use absolute paths:

```bash
rg -n "availableTools" /home/de3p/V3Code/src/vs/workbench/contrib/void/common/prompt/prompts.ts
sed -n '1,80p' /home/de3p/V3Code/src/vs/workbench/contrib/void/common/localAgentRuntime.ts
```

Never run V3Code's build (`npm ci` there is gigabytes and hours). Never write into it.

## Where V3Code and co4fe3 differ on purpose

| V3Code | co4fe3 | Why |
|---|---|---|
| Owns its agent loop (`chatThreadService`, `v3codeChatAgent`) | TrueForge owns the loop; we see events and answer pauses | eligibility gate |
| Edits stream into the buffer, accept/reject rewrites it | Proposal document + diff editor; one write after the decision | "no silent writes", extension API |
| Hybrid vector + BM25 index, optional Rust sidecar | Lexical + graph + grep + recent channels, no models | no native deps, 1-day build |
| Many modes (chat, read, plan, debug, multitask, agent) | agent, ask, plan | scope |
| Subagents nest 2 deep and queue | TrueForge: one level, all parallel, no queue | harness limit |
