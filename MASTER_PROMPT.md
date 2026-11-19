# Master prompt (paste into Devin with /home/de3p/co4fe3 open)

You are building **co4fe3**: a VS Code extension that is a coding agent whose agent loop runs on TrueForge in local
mode. Read `AGENTS.md`, then every file in `.devin/rules/`. They are binding. A rule beats a task: if a task needs you to
break a rule, stop and ask.

The reference architecture is **V3Code** at `/home/de3p/V3Code` (read-only, Apache-2.0, built on Void). Read
`docs/study/v3code.md` before designing anything: it maps each idea we use to the V3Code file it comes from, and says
what we adopt, adapt or skip. Take ideas, never code (rule 05). V3Code is a full editor; co4fe3 is an extension, so
anything that needs workbench internals is replaced by the public extension API.

## The goal, in judge terms

On `pallets/flask` at tag 3.1.3 (commit 22d92470), the extension must show these on screen, in this order:

- **Task A, inline edit.** Select `get_debug_flag` in `src/flask/helpers.py`, press `Ctrl+Alt+K`, type the instruction.
  A diff streams into a diff editor. Accept it hunk by hunk.
  `FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` prints `False`.
- **Task B, agent mode.** In the panel, with no files named, type the `flask config` instruction. The panel shows the
  context pack (which files were chosen, why, and the tokens used), the crew's briefs and reports, and tool cards.
  Edits to 3 or more files pause for per-hunk review. Show Undo on one applied hunk.
  `pytest tests/test_cli.py -q` passes and `flask config` prints masked JSON. The TrueForge session is shown.
- **Task C, resilience.** Break the primary model (invalid key or unreachable URL) and repeat Task A. The editor stays
  responsive. A banner says what failed and that the fallback model took over. The diff appears from the fallback.
  `git status` stays clean until a hunk is accepted.

## How you work

Run `/start-session`. Then run the workflows in `.devin/workflows/` in numeric order, one per message:

```
00-bootstrap → 01-trueforge-spike → 02-mcp-server → 03-review-core → 04-inline-edit → 05-agent-panel
→ 06-context → 07-crew → 08-models-fallback → 09-latency → 10-instructions → 11-rehearse → 12-package → 13-submit
```

Do not start workflow N+1 until workflow N's exit check passes. Paste the command output into
`docs/progress/NN-name.md` as evidence. Workflows 00–08 are the floor: if time runs short, cut from the list in
rule 95, never from Tasks A, B or C.

Every task runs this loop:

1. **Restate** the goal and the exit check in 3 lines.
2. **Look up** every name you will use, in `docs/CODEMAP.md`, rule 20, or the installed `.d.ts`. Never from memory.
   For a design question, check how V3Code solved it (`docs/study/v3code.md`, then the V3Code file).
3. **Fill the box** (rule 90): GOAL / FILES (≤ 2) / PATTERN (from docs/PATTERNS.md) / CHECK (exact command).
4. **Build** the smallest vertical slice that runs end to end.
5. **Verify** with real commands: `npm run verify:fast` after each edit, `npm run verify` before each commit, and the
   Extension Development Host for anything a judge sees.
6. **Commit** in house format, then report: done / evidence / next / blockers.

Never claim something works without running it. Same error twice → stop, write *tried / saw / now suspect*, ask.
