---
description: Triage a bug seen in a rehearsal or a test - reproduce, classify, locate, failing test first, fix, prove
argument-hint: "<what you saw>"
---

# Bug triage: $ARGUMENTS

## 1. Reproduce and write it down (before touching code)

```
SAW:      <exact text on screen / log line / test output>
WHERE:    inline | panel | review | MCP | TrueForge | model
REPRO:    <smallest steps; prefer a fake-model script over the real model>
EXPECTED: <what rule/workflow says should happen, with the rule number>
```

## 2. Classify (pick one; each has a different fix path)

| Class | Signal | Fix path |
|---|---|---|
| ours: pure logic | it reproduces in a unit test | failing unit test → fix in agent-core |
| ours: wiring | unit tests pass, the Extension Development Host fails | log the PanelEvents and `perf` lines → integration test → fix in the extension |
| TrueForge contract | an event or field differs from rule 20 | record it in `docs/progress/01-spike.md`, fix rule 20 **and** the code in one commit |
| model quality | the tools worked, the model chose badly | improve generic tool descriptions or the lead text; never special-case flask; or write it up as a limitation |
| provider limit | 429, quota or a stall in the output channel | nothing to fix in code: check stats, benching and the fallback banner; wait or reorder |

## 3. Locate

Find the matching `perf`, `mcp error` or `turn.done` line in the output channel. Look up the function in
`docs/CODEMAP.md`, read the whole file, and follow one caller up.

## 4. Failing test first

Write the smallest test that fails for the reason in SAW. Run it and paste the failure.

## 5. Fix, then prove

Smallest change. `npm run verify:fast`, the test now passes, then `npm run verify`. Re-run the original REPRO.

## 6. Two strikes

If the same fix idea failed twice, stop. Write *tried / saw / now suspect* and ask.
