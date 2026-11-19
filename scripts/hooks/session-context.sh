#!/usr/bin/env bash
# SessionStart: re-orient a small model that just lost its context.
set -euo pipefail
cat <<'CTX'
CO4FE3 — session context (read this, then docs/CODEMAP.md)

A VS Code coding agent whose loop runs on TrueForge (local, :8790). Deadline Fri 20 Nov 2026 23:59 IST.
`npm run verify` must be green before every commit (a hook enforces it).
Laws: 1 TrueForge runs the loop, never call a provider. 2 agent-core imports no vscode. 3 only review/apply.ts writes.
4 nothing reaches disk before a person accepts a hunk. 5 cancel leaves the workspace consistent.
6 never write an SDK/VS Code/MCP name from memory (rule 20, CODEMAP, .d.ts). 7 no secrets in git. 8 verify before commit.
The runtime crew = a lead + subagents TrueForge spawns (the lead names them), brief down / report up, board for facts.
Fixed tasks: A inline edit (get_debug_flag), B agent mode (flask config command, 3+ files), C fallback when the model fails.
Reference architecture: V3Code at /home/de3p/V3Code (read-only). Ideas yes, code never (rule 05, docs/study/v3code.md).
Copy patterns from docs/PATTERNS.md. Check docs/ANTI-PATTERNS.md before reporting done.
Start: /start-session   Stuck twice on the same error: STOP, write tried/saw/now suspect, re-plan.
CTX
if [ -f .devin/ledger.md ]; then
  echo; echo "Files touched this session so far:"; awk '{print "  " $3}' .devin/ledger.md | sort -u | head -20
fi
exit 0
