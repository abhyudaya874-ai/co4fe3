---
description: Make the product read the user's AGENTS.md, rules, workflows and skills (Devin-compatible), with the load_instructions tool, slash workflows and the instructions chip
argument-hint: ""
---

# 10 Project instructions in the product (cut first if behind; rule 95)

Goal: open any repo that has a Devin pack (this repo is one), and co4fe3 shows `AGENTS.md · n rules inline · m on
demand`. `/start-session` in the composer expands that workflow. The agent can `load_instructions` a skill.
Rule 85 is the spec.

## Steps

1. `instructions/frontmatter.ts` and `instructions/load.ts` exactly as in rule 85. Tests first (`instructions.test.ts`):
   - frontmatter: scalars, `[a, b]` lists, `- item` lists, quoted values, no frontmatter, CRLF;
   - `.co4fe3/` wins over `.devin/` per kind; a missing folder is fine;
   - `always_on` is inline until the 2,500-token budget, after which it moves to on-demand;
   - a `glob` rule is inline only when a matching file is in the pack;
   - `manual` rules and workflows are never inline;
   - `globToRegExp`: `**/*.py`, `src/*`, `docs/**`;
   - `expandWorkflow`: known name, unknown name, `$ARGUMENTS`.
2. Load through `EditorHost` only. Folders: `listFiles()` filtered by prefix, then `readText()`.
3. Register `load_instructions` in `mcp/server.ts` (rule 85 code) and add it to the coder agent's tool list check in
   `check-invariants.mjs`.
4. Panel: the `instructions` PanelEvent renders the chip. The composer lists workflows on `/`, using the
   `complete` UiCommand.
5. Watcher: `vscode.workspace.createFileSystemWatcher("{AGENTS.md,.co4fe3/**,.devin/**}")` → `set.stale = true`.
   The next new session reloads.

## Check in the Extension Development Host

Open `/home/de3p/co4fe3` itself in the Development Host and send "what are the eight laws?". The answer should cite
`AGENTS.md` without a tool call, because AGENTS.md is inline. Then type `/start-session` and confirm that the
workflow text expands and runs.

## Exit check

- `instructions.test.ts` green; the chip shows real counts on this repo.
- Commit: `instr: read AGENTS.md, rules, workflows and skills like Devin`
