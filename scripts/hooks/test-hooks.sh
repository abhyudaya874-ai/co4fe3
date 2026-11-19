#!/usr/bin/env bash
# Self-test for the guard hooks: feeds sample payloads and checks each exit code (2 = blocked, 0 = allowed).
# Run by `npm run verify` / `verify:fast` (stage "hooks"). Needs jq, like the hooks themselves.
# Add a case here whenever a guard gains a rule. Never weaken a case to make it pass (AGENTS.md, "When stuck").
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
command -v jq >/dev/null 2>&1 || { echo "test-hooks: jq is not installed (the hooks need it too)"; exit 1; }

pass=0; fail=0
t() {
  local want="$1" name="$2" hook="$3" json="$4" out code
  out=$(printf '%s' "$json" | timeout 10 bash "scripts/hooks/$hook" 2>&1); code=$?
  if [ "$code" = "$want" ]; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "FAIL (got $code, want $want) $name :: ${out:0:160}"; fi
}
w() { jq -cn --arg p "$1" --arg c "$2" '{tool_input:{file_path:$p, content:$c}}'; }   # write payload, JSON-escaped by jq
x() { jq -cn --arg c "$1" '{tool_input:{command:$c}}'; }                              # exec payload

# --- guard-write: architecture laws ---
t 2 "core imports vscode"               guard-write.sh "$(w packages/agent-core/src/x.ts 'import * as vscode from "vscode";')"
t 2 "core writes a file"                guard-write.sh "$(w packages/agent-core/src/x.ts 'await fs.promises.writeFile(p, s);')"
t 2 "core spawns a process"             guard-write.sh "$(w packages/agent-core/src/x.ts 'import { spawn } from "node:child_process";')"
t 0 "core pure code"                    guard-write.sh "$(w packages/agent-core/src/x.ts 'export const rrfMerge = () => [];')"
t 2 "write outside apply.ts"            guard-write.sh "$(w extensions/co4fe3-vscode/src/inline/inlineEdit.ts 'await vscode.workspace.applyEdit(e);')"
t 0 "write inside apply.ts"             guard-write.sh "$(w extensions/co4fe3-vscode/src/review/apply.ts 'await vscode.workspace.applyEdit(e); await doc.save();')"
t 2 "child_process outside commands.ts" guard-write.sh "$(w extensions/co4fe3-vscode/src/panel/x.ts 'import { spawn } from "node:child_process";')"
t 0 "child_process in commands.ts"      guard-write.sh "$(w extensions/co4fe3-vscode/src/host/commands.ts 'import { spawn } from "node:child_process";')"
t 2 "provider host in extension"        guard-write.sh "$(w extensions/co4fe3-vscode/src/x.ts 'fetch("https://integrate.api.nvidia.com/v1/chat")')"
t 2 "provider SDK in core"              guard-write.sh "$(w packages/agent-core/src/x.ts 'import OpenAI from "openai";')"
t 2 "innerHTML in webview"              guard-write.sh "$(w extensions/co4fe3-vscode/webview/src/App.tsx '<div dangerouslySetInnerHTML={{__html: t}} />')"
# --- guard-write: secrets ---
t 2 "real key in a file"                guard-write.sh "$(w config/providers.json '"apiKey": "nvapi-abcdefghijklmnopqrstuvwxyz0123"')"
t 0 "placeholder key"                   guard-write.sh "$(w config/providers.json '"apiKey": "${NVIDIA_API_KEY}"')"
# --- guard-write: rule 05 (V3Code is a read-only reference; no copied code) ---
t 2 "write into V3Code"                 guard-write.sh "$(w /home/de3p/V3Code/src/vs/workbench/contrib/void/common/x.ts 'export const a = 1;')"
t 2 "V3Code header in core"             guard-write.sh "$(w packages/agent-core/src/context/rrf.ts '/*  Copyright (c) 2025-2026 KandD Labs. Licensed under the Apache License, Version 2.0. */')"
t 2 "Void header in extension"          guard-write.sh "$(w extensions/co4fe3-vscode/src/review/x.ts ' *  Copyright 2025 Glass Devtools, Inc. All rights reserved.')"
t 0 "V3Code named in a doc"             guard-write.sh "$(w docs/study/v3code.md 'V3Code (KandD Labs) uses RRF with k = 60.')"
t 0 "credit in a code comment"          guard-write.sh "$(w packages/agent-core/src/context/rrf.ts '// RRF k = 60, as in V3Code semanticIndex/rrf.ts (idea only).')"
# --- guard-write: outside the repo ---
t 2 "write to /etc"                     guard-write.sh "$(w /etc/hosts '127.0.0.1 x')"

# --- guard-exec ---
t 2 "unpinned install"                  guard-exec.sh "$(x 'npm i diff')"
t 0 "pinned install"                    guard-exec.sh "$(x 'npm i --save-exact diff@8.0.2')"
t 0 "flask clone reset"                 guard-exec.sh "$(x 'cd .cache/flask && git reset --hard 3.1.3 && git clean -fd -e .venv')"
t 2 "repo reset --hard"                 guard-exec.sh "$(x 'git reset --hard HEAD~1')"
t 2 "force push"                        guard-exec.sh "$(x 'git push --force origin main')"
t 2 "curl a provider"                   guard-exec.sh "$(x 'curl -s https://integrate.api.nvidia.com/v1/models')"
t 0 "grep for a provider host"          guard-exec.sh "$(x 'grep -rn integrate.api.nvidia.com packages')"
t 2 "trueforge @latest"                 guard-exec.sh "$(x 'npx @truefoundry/trueforge@latest')"
t 2 "key on a command line"             guard-exec.sh "$(x 'NVIDIA_API_KEY=nvapi-abcdefghijklmnopqrstuvwxyz0123 node x.mjs')"
t 2 "publish"                           guard-exec.sh "$(x 'npx @vscode/vsce publish')"
t 2 "build V3Code"                      guard-exec.sh "$(x 'cd /home/de3p/V3Code && npm ci')"
t 0 "read V3Code"                       guard-exec.sh "$(x 'rg -n availableTools /home/de3p/V3Code/src/vs/workbench/contrib/void/common/prompt/prompts.ts')"
t 0 "read V3Code, stderr dropped"       guard-exec.sh "$(x 'sed -n 1,40p /home/de3p/V3Code/beast/README.md 2>/dev/null | head -20')"
t 2 "redirect into V3Code"              guard-exec.sh "$(x 'echo x > /home/de3p/V3Code/notes.txt')"
t 2 "sed -i in V3Code"                  guard-exec.sh "$(x 'sed -i s/a/b/ /home/de3p/V3Code/README.md')"

# --- guard-exec: the commit gate (uses a throwaway stamp so the real one is untouched) ---
stamp=.devin/.last-verify; had_stamp=0; [ -f "$stamp" ] && { had_stamp=1; cp "$stamp" "$stamp.bak"; }
rm -f "$stamp"
t 2 "commit with no full verify"        guard-exec.sh "$(x 'git commit -m x')"
if [ "$had_stamp" = 1 ]; then mv "$stamp.bak" "$stamp"; fi

# --- session-context prints and succeeds ---
t 0 "session context"                   session-context.sh '{}'

echo "test-hooks: $pass passed, $fail failed"
[ "$fail" = 0 ]
