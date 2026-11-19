---
description: Make the product read the user's AGENTS.md and other instruction files, rules, skills (with V3Code-style triggers) and workflows, with the load_instructions tool, active skills per turn, slash workflows and the instructions chip
argument-hint: ""
---

# 10 Project instructions in the product (cut first if behind; rule 95)

Goal: open any repo that has a Devin pack (this repo is one) or a `.v3code/skills` folder, and co4fe3 shows
`AGENTS.md · n rules · k skills active · m on demand`. `/start-session` in the composer expands that workflow. The
agent can `load_instructions` a skill. Rule 85 is the spec. Its file list, caps and skill triggers follow V3Code
(`docs/study/v3code.md` §8).

The 20-line fallback, if this workflow is cut: read `AGENTS.md` only, cut it at 8,000 chars with the truncation note,
and append it to the lead's instructions.

## Steps

1. `instructions/frontmatter.ts` and `instructions/load.ts` exactly as in rule 85. Tests first
   (`frontmatter.test.ts`, `instructions.test.ts`), with every case listed at the end of rule 85.
2. Load through `EditorHost` only. Instruction files: `readText()` for each name in `INSTRUCTION_FILES`. Folders:
   `listFiles()` filtered by prefix, then `readText()`.
3. `load_instructions` is already registered (workflow 02, with `kind: "rule" | "skill" | "file"`). Wire its
   `instructions()` dependency to the cached set.
4. Turn message: `renderActiveSkills(activeSkills(set, text, files))` goes **before** the pack (workflow 05 `send`).
   The agent instructions get `<skills_index>` once, at session creation.
5. Panel: the `instructions` PanelEvent renders the chip, with the active skill names. The composer lists workflows
   on `/`, using the `complete` UiCommand.
6. Watcher: the glob from rule 85 "Change handling" → `set.stale = true`. The next new session reloads.

## Check in the Extension Development Host

1. Open `/home/de3p/co4fe3` itself in the Development Host and send "what are the eight laws?". The answer should cite
   `AGENTS.md` without a tool call, because AGENTS.md is inline.
2. Type `/start-session` and confirm that the workflow text expands and runs.
3. Send "use the latency probe" and confirm that the chip shows `latency-probe` as an active skill, because its
   description and name match the keywords. If it is not active, it must at least be listed in `<skills_index>`.

## Exit check

- `frontmatter.test.ts` and `instructions.test.ts` green; the chip shows real counts on this repo.
- Commit: `instr: read AGENTS.md, instruction files, rules, skills and workflows like Devin and V3Code`
