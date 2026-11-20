# 11 — rehearsal checklist (Dev Host on .cache/flask @ 3.1.3)

Baseline verified headlessly: `git status` clean at 22d92470 (release 3.1.3); `.venv/bin/python -m pytest
tests/test_cli.py -q` → **55 passed, 3 skipped** (this becomes 56 after Task B). Window: 1920×1080, editor
font 15, panel 520 px, integrated terminal on `.venv`.

## Run 1 — ____ (fill date/time)

### A — inline edit
- [ ] select `get_debug_flag`; Ctrl+Alt+K + verbatim A instruction → diff opens at once, right side grows
- [ ] stream ends → ✓/✗ lenses per hunk; header names the model; TTFT = ____ s
- [ ] accept all → toast "Applied n of n hunks"
- [ ] `FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` → `False`
- [ ] docstring lists `0`, `false`, `no`, `off`, `n` case-insensitively
- [ ] Undo → `git diff --stat` empty → re-accept → change back

### B — agent mode (verbatim B instruction, no @mentions)
- [ ] pack card: cli.py, test_cli.py, docs/cli.rst near top + reasons + token bar
- [ ] "Plan / Files" first message; crew rows (briefs/reports); tool cards
- [ ] 3+ files proposed with `why` shown; accept all
- [ ] `run_command` card shows `pytest tests/test_cli.py -q` → Allow
- [ ] "Open session in TrueForge" shows turns/tools/threads (3 s on screen)
- [ ] `pytest tests/test_cli.py -q` → 56 passed
- [ ] `FLASK_APP=/tmp/demo_app.py flask config` → SECRET_KEY/API_TOKEN/DB_PASSWORD all `***`, others real
- [ ] `flask --help` shows `config` next to `routes`, `run`, `shell`
- [ ] `git diff --stat` → 3+ files

### C — resilience
- [ ] break nvidia-nim's key in TF Settings → Models; repeat A
- [ ] banner names the failure + answering model; diff streams from the fallback
- [ ] editor responsive while waiting; `git status` clean before AND after Reject all
- [ ] restore: `npm run setup:trueforge` + `co4fe3: Reset model stats`

## Run 2 — ____
(same three blocks; two consecutive green runs with zero code changes between them ends the workflow)

## TTFT log
| run | A ttft | B ttft | C answered by |
|---|---|---|---|
| 1 | | | |
| 2 | | | |
