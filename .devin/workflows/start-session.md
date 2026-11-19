---
description: Orient at the start of a session - repo state, gate state, TrueForge state, which workflow is next
argument-hint: ""
---

# Start session

Run these and report the results in the block below. Do not start work before the block is filled in.

```bash
git status --short | head -20
git log --oneline -5
cat .devin/.last-verify 2>/dev/null || echo "no full verify yet"
ls docs/progress/ 2>/dev/null
curl -s -o /dev/null -w "trueforge %{http_code}\n" --max-time 2 http://localhost:8790/api/v1/docs || echo "trueforge DOWN (npm run trueforge)"
node -v   # must be >= 22.14 (TrueForge requires it)
date "+%a %d %b %H:%M %Z"
```

Then read, in this order: `AGENTS.md`, `docs/CODEMAP.md` (just the headings), the newest `docs/progress/NN-*.md`.

## Report (fill in all 6 lines)

```
TIME:      <now> — next row of the timebox (rule 95): <row>, on track | behind by <h>
REPO:      <clean | n changed files: …>
GATE:      last full verify <timestamp or never>; source newer than it? <yes/no>
TRUEFORGE: <up 200 | down>
NEXT:      workflow <NN-name>, step <n>  (from docs/progress)
BLOCKERS:  <none | one line each>
```

If the timebox says you are behind by more than 2 hours, propose the cut (rule 95) **before** starting work.
