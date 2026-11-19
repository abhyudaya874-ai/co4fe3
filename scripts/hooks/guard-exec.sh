#!/usr/bin/env bash
# PreToolUse guard on exec. Exit 2 blocks; the JSON reason is shown to the agent.
# Every message says WHAT to do next, because the model reading it is small.
set -euo pipefail
. "$(dirname "$0")/_lib.sh"
read_payload
cmd="$(field '.tool_input.command')"
[ -z "$cmd" ] && exit 0
inspecting() { printf '%s' "$cmd" | grep -qE '^\s*(grep|rg|echo|git (log|diff|show))\b'; }

# 1. A real provider key in a command line ends up in shell history and logs.
if printf '%s' "$cmd" | grep -qE "$KEY_RE" && ! inspecting; then
  block "A provider API key is in this command. Put keys in your shell environment (.env, never committed) and let scripts/setup-trueforge.mjs read them. Remove the key from the command and retry."
fi

# 2. Talk to models through TrueForge only, even when experimenting.
if printf '%s' "$cmd" | grep -qE "(curl|wget|httpie|xh)\b[^|;&]*($PROVIDER_HOST_RE)" && ! inspecting; then
  block "Direct provider calls are not how co4fe3 works (law 1). Test a model through TrueForge: node scripts/spike.mjs text (SPIKE_MODEL=<fqn>) or npm run bench:latency."
fi

# 2b. V3Code is a read-only reference (rule 05): read it, never build or change it.
if printf '%s' "$cmd" | grep -qE '/home/de3p/V3Code|(^|[[:space:]])V3Code/' \
   && printf '%s' "$cmd" | grep -qE '\b(npm|npx|yarn|pnpm|cargo|make|gulp|node)\b|\b(rm|mv|cp|tee|touch|chmod|sed -i|patch)\b|\bgit\s+(commit|checkout|reset|clean|stash|pull|push|apply|restore|switch)\b|>>?\s*(/home/de3p/)?V3Code/'; then
  block "V3Code is a read-only reference (rule 05). Read it with rg / sed -n / cat / git log; never build, install or change it. Its build is gigabytes and hours, and co4fe3 does not need it."
fi

# 3. TrueForge is pinned.
if printf '%s' "$cmd" | grep -qE '@truefoundry/trueforge@latest'; then
  block "TrueForge is pinned. Run: npm run trueforge (it uses the version in package.json)."
fi

# 4. Installs of a NAMED package must be pinned.
if printf '%s' "$cmd" | grep -qE '\b(npm|pnpm|yarn)\s+(install|i|add)\s+[^-[:space:]]' \
   && ! printf '%s' "$cmd" | grep -qE -- '--save-exact|-E\b'; then
  block "Unpinned install. Rerun as: npm i --save-exact <pkg>@<version> (add -w <workspace> or -D as needed). State in the commit body why this dependency is needed."
fi

# 5. Destructive git, except resetting the flask rehearsal clone.
if printf '%s' "$cmd" | grep -qE 'git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f|git\s+push\s+(.*\s)?(--force|-f)\b'; then
  if ! printf '%s' "$cmd" | grep -qE '^\s*cd\s+\.cache/flask\s*&&'; then
    block "Destructive git command. Commit or stash first (git status, git stash). The only allowed reset is the rehearsal clone: cd .cache/flask && git reset --hard 3.1.3 && git clean -fd -e .venv"
  fi
fi

# 6. Publishing is out of scope.
if printf '%s' "$cmd" | grep -qE '\bnpm\s+publish\b|vsce\s+publish'; then
  block "Publishing is a non-goal (rule 00). Package with: npx @vscode/vsce package --no-dependencies -o co4fe3.vsix"
fi

# 7. verify may not be skipped.
if printf '%s' "$cmd" | grep -qE 'verify\.mjs.*--(skip|no-)'; then
  block "verify cannot be skipped. If a stage is genuinely wrong, say which and why, and fix the stage in its own commit (with the human's okay)."
fi

# 8. THE commit gate: no commit unless the last FULL verify is newer than every source file.
if printf '%s' "$cmd" | grep -qE '(^|[;&|]\s*)git\s+commit\b'; then
  if source_newer_than_verify; then
    block "Commit blocked: source changed since the last full verify (or it never ran). Run: npm run verify  (not verify:fast). Then commit."
  fi
fi

exit 0
