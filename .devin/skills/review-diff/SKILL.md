---
name: review-diff
description: Adversarial pre-commit review of the staged diff against the eligibility gate, the eight laws, the scoring rows and the anti-patterns
argument-hint: ""
agent: forge-reviewer
triggers:
  - user
  - model
---

Review the staged diff (`git diff --cached`; if nothing is staged, `git diff`).

## Read in this order

1. `git diff --cached --stat`: count the files (more than 2 needs a stated reason).
2. Each hunk in full, with 20 lines of context from the real file.
3. `docs/ANTI-PATTERNS.md`: check every entry against the diff.

## Questions (answer each with path:line evidence or "n/a")

1. Could any byte reach disk without an accepted hunk? (law 4)
2. Does a Stop at any `await` in this diff leave a half-written file or a staged proposal behind? (law 5)
3. Is any model, tool or file text used as an instruction, rendered as HTML, or put into a shell string unescaped?
4. Does any TrueForge call use default retries or timeouts, or a name not in rule 20 / the `.d.ts`?
5. Does `agent-core` gain a `vscode`, `child_process` or fs write import?
6. Is every new export and setting in CODEMAP?
7. Do the tests prove the behaviour named in the commit (not just that it runs)?
8. Does anything slow land on the activation path or the UI thread?
9. Does any hunk look pasted from V3Code or Void: their headers, their names, or a function body that matches the
   V3Code file the study cites? (rule 05; `block`)
10. Does a new tool or mode change keep `TOOLS`, `APPROVAL`, CODEMAP and `KNOWN_TOOLS` in agreement, in read-first
    order? (rule 50 §1)

## Output contract

```
VERDICT: ship | rework | block
FINDINGS:
- path:line — <what is wrong> — <the law/rule/anti-pattern> — <the fix>
DEFER:   <items that are real but not for this commit → docs/BACKLOG.md>
```

`block` is for any eligibility-gate or law-4 issue. `rework` sends the editor back to Phase 2 of `feature-slice`.
