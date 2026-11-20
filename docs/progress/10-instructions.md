# 10 — project instructions in the product (rule 85)

## Built

- `instructions/frontmatter.ts` — tiny YAML subset: scalars, `[a, b]` + `- item` lists, one `triggers:` nesting
  level, `>`/`>-`/`|`/`-|-` block scalars, quoted values, CRLF, malformed lines ignored. 8 tests.
- `instructions/load.ts` — `INSTRUCTION_FILES` (AGENTS.md cap 8,000 chars + truncation note; others 4,000),
  `.co4fe3`/`.devin` rules, `.co4fe3`/`.v3code`/`.devin` skills (`SKILL.md`), `.co4fe3`/`.devin` workflows,
  `selectInline` (4k-token budget, files→rules→rest order, glob-rules inline only on match), `activeSkills`
  (alwaysApply / glob / keyword, 1.5k budget, loadOnDemand excluded), `renderInstructions` (stable prefix +
  `<skills_index>` + on-demand list), `renderActiveSkills`, `expandWorkflow` (`/name args` → body + `$ARGUMENTS`),
  `globToRegExp`. 8 tests.
- **Bug found in rule 85's globToRegExp**: a trailing `**` (`src/**`) fell through to `[^/]*` and could never
  span folders — the commonest skill-glob shape. Fixed: `**/x` → optional dir prefix, lone `**` → `.*`.
- `load_instructions` MCP tool (workflow 02) is wired to the cached set via `McpDeps.instructions`.
- Turn message order (rule 85): `<active_skills>` → context pack → request. `renderInstructions` (with
  `<skills_index>` + on-demand list) is the session spec's instructions.
- Panel: the `instructions` chip renders as an expandable details row — `AGENTS.md · n rules · k skills
  active · m on demand`.
- Composer `/` completes workflows (workflow 06); `expandWorkflow` runs the body with `$ARGUMENTS`.
- Staleness: a `FileSystemWatcher` on the rule-85 glob marks the set stale → the next `instructions()` reloads.
  Both call sites (MCP handler + agentTurn) share one cached `instructions()` now (previously re-read all files
  every turn).

## Tests

- `frontmatter.test.ts` (8), `instructions.test.ts` (8): caps + truncation note, `.co4fe3`-wins order, `.v3code`
  skill discovery, 4k budget overflow → on-demand, glob-rule inline only on match, activeSkills keyword/glob/
  alwaysApply + loadOnDemand excluded, expandWorkflow known/unknown/$ARGUMENTS, globToRegExp semantics.

## PENDING THE HUMAN (Dev Host on this repo)

1. "what are the eight laws?" — should cite AGENTS.md with no tool call (it's inline).
2. `/start-session` in the composer expands and runs.
3. "use the latency probe" — chip shows `latency-probe` active (or at least in `<skills_index>`).
