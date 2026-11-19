---
description: Rehearse Tasks A, B and C on a clean flask 3.1.3 exactly as the judges will, with every on-screen verification, until two full runs pass without a fix
argument-hint: "[A|B|C|all]"
---

# 11 Rehearse the fixed tasks: $ARGUMENTS

Judges compare videos run on the same repo with the same words, so rehearse with the exact text from rule 00.
Every rehearsal starts from a clean tree:

```bash
cd .cache/flask && git reset --hard 3.1.3 && git clean -fd -e .venv && git status --short && cd -    # destructive ON PURPOSE, only inside .cache/flask
```

(The guard hook allows `git reset --hard` only when the command starts with `cd .cache/flask`.)

Open the Extension Development Host on `.cache/flask` (`F5` → the "Run co4fe3 on flask" launch config). Use a
1920×1080 window, editor font size 15, the panel 520 px wide, and the integrated terminal at the bottom using
`.venv`.

## A. Inline edit

| Step | Expected on screen |
|---|---|
| open `src/flask/helpers.py`, select `get_debug_flag` from `def` to `return` | the selection is visible |
| Ctrl+Alt+K, type the A instruction verbatim, Enter | the diff opens at once; the right side grows while streaming; "Waiting for …" disappears at the first token |
| the stream ends | ✓/✗ lenses on each hunk; the header names the model |
| accept each hunk | toast: "Applied n of n hunks to helpers.py · Undo" |
| `FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` | `False` |
| (B2 beat) click Undo, `git diff --stat`, then redo the accept | empty after Undo; the change is back after re-accepting |

Also check that the docstring now lists `0`, `false`, `no`, `off` and `n`, case-insensitively. Write down the TTFT
from the status bar.

## B. Agent mode

| Step | Expected on screen |
|---|---|
| open the co4fe3 panel, type the B instruction verbatim (no @mentions), Send | the pack card appears with cli.py, test_cli.py and docs/cli.rst near the top, plus reasons and the token bar |
| streaming | the lead's "Plan / Files" message; crew rows with briefs and reports; tool cards (read_file, search_workspace…) |
| proposals | 3+ files, each pausing with a diff card and lenses; the `why` is shown; accept all hunks |
| `run_command` approval | the card shows `pytest tests/test_cli.py -q`; Allow |
| the end | the lead's summary lists changed files and the verification |
| "Open session in TrueForge" | the TrueForge page shows the turns, tool calls and subagent threads (keep it on screen for 3 s) |
| terminal: `pytest tests/test_cli.py -q` | passes |
| terminal: `printf 'from flask import Flask\napp = Flask(__name__)\napp.config["SECRET_KEY"] = "s3"\napp.config["API_TOKEN"] = "t"\napp.config["DB_PASSWORD"] = "p"\n' > /tmp/demo_app.py && FLASK_APP=/tmp/demo_app.py flask config` (venv active) | JSON where `SECRET_KEY`, `API_TOKEN`, `DB_PASSWORD` (and every other key containing SECRET, PASSWORD, TOKEN or KEY) read `"***"`, and other keys show real values |
| `flask --help` | `config` is listed next to `routes`, `run` and `shell` |
| `git diff --stat` | 3+ files |

If the run fails, classify the failure before fixing anything:
- **(1) Our bug.** Fix it, add a test, re-run.
- **(2) Model quality.** Do not tune prompts for flask. Improve generic guidance (tool descriptions, the lead text)
  or note it as a limitation.
- **(3) Free-tier limit.** Wait, or switch the order.

## C. Resilience

Follow rule 70's Task C checklist. Expected: the banner says the primary failed and names the fallback; the diff
streams from the fallback; the editor stays responsive (type in another file while it waits); `git status` is
clean before and after **Reject all**.

## Exit check

- Two consecutive `all` runs pass every row with no code change between them. Record the timestamps and TTFTs in
  `docs/progress/11-rehearse.md`.
- Restore everything: `npm run setup:trueforge`, `co4fe3: Reset model stats`, flask reset.
