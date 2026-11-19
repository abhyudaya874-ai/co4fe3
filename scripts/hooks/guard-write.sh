#!/usr/bin/env bash
# PreToolUse guard on edit/write: architecture laws and secret hygiene, caught at write time (check-invariants.mjs
# catches the same things again at verify time).
set -euo pipefail
. "$(dirname "$0")/_lib.sh"
read_payload

path="$(field '.tool_input.file_path // .tool_input.path')"
new="$(field '.tool_input.new_string // .tool_input.new_str // .tool_input.content // .tool_input.file_text')"
[ -z "$path" ] && exit 0
has() { printf '%s' "$new" | grep -qE -- "$1"; }

# Law 7: no secrets in any file.
if has "$KEY_RE"; then
  block "This write contains what looks like a real API key. Keys live in the environment only. Use a placeholder like \${NVIDIA_API_KEY} (config/providers.example.json) and retry."
fi

case "$path" in
  # Law 2: agent-core stays editor-free and write-free.
  *packages/agent-core/src/*)
    if has "from ['\"]vscode['\"]|require\(['\"]vscode['\"]\)"; then
      block "packages/agent-core must not import vscode (law 2). Put the VS Code part in extensions/co4fe3-vscode/src and pass it in through EditorHost or Applier (rule 10)."
    fi
    if has "child_process|writeFile|appendFile|\bunlink\(|\brmSync\(|\brm\(|createWriteStream"; then
      block "packages/agent-core may not spawn processes or write files (laws 2 and 3). Ask EditorHost.run for commands and Applier.apply for writes."
    fi
    ;;
esac

case "$path" in
  # Law 3: one write path.
  *extensions/co4fe3-vscode/src/review/apply.ts) ;;
  *extensions/co4fe3-vscode/src/*)
    if has "workspace\.applyEdit|workspace\.fs\.(writeFile|delete|rename)|\.save\(\)|fs\.(promises\.)?writeFile"; then
      block "Only extensions/co4fe3-vscode/src/review/apply.ts writes workspace files (law 3). Call Applier.apply / applyDecision instead."
    fi
    ;;
esac

case "$path" in
  *extensions/co4fe3-vscode/src/host/commands.ts) ;;
  *extensions/co4fe3-vscode/src/*)
    if has "child_process"; then
      block "Only extensions/co4fe3-vscode/src/host/commands.ts spawns processes (rule 10). Use runCapped() from there."
    fi
    ;;
esac

case "$path" in
  # Law 1: no provider hosts or SDKs in product code.
  *packages/*|*extensions/*)
    if has "$PROVIDER_HOST_RE|from ['\"](openai|@google/genai|@google/generative-ai|@anthropic-ai/sdk)['\"]"; then
      block "Product code never calls a model provider (law 1). Models are configured in TrueForge; the extension only talks to TrueForge."
    fi
    ;;
esac

case "$path" in
  # Rule 05: V3Code is a read-only reference.
  /home/de3p/V3Code/*|*/V3Code/src/*|*/V3Code/beast/*) block "V3Code is a read-only reference (rule 05). Write the idea in co4fe3's own code instead; never edit /home/de3p/V3Code." ;;
esac

# Rule 05: no copied V3Code/Void code in the product (docs may quote names, but never a licence header).
case "$path" in
  *packages/*|*extensions/*|*scripts/*|*test/*)
    if has "Copyright.{0,40}(KandD Labs|Glass Devtools)|Part of V3Code, distributed by|Licensed under the Apache License, Version 2\.0\. See LICENSE\.txt"; then
      block "This looks like copied V3Code/Void code (it carries their licence header). co4fe3 reimplements ideas in its own code (rule 05): describe the idea, close the V3Code file, and write it fresh."
    fi
    ;;
esac

case "$path" in
  # Model text is data: never HTML.
  *extensions/co4fe3-vscode/webview/*)
    if has "dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\("; then
      block "The webview renders model text as React elements only (rule 30, prompt injection). Use the md.tsx renderer."
    fi
    ;;
esac

# Nothing outside the repo.
case "$path" in
  /etc/*|/usr/*|/opt/*|/var/*|/root/*|"$HOME"/.config/*|"$HOME"/.local/*) block "Write outside the repo: $path" ;;
esac

exit 0
