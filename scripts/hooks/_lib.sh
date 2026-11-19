#!/usr/bin/env bash
# Shared helpers, sourced by the guards.
# HOOK_DEBUG=1 appends every payload to .devin/hook-debug.log, so you can confirm the field names your Devin version
# actually sends (file_path vs path, old_string vs old_str ...).

read_payload() {
  payload="$(cat)"
  # Without jq every guard would silently pass. Fail closed, loudly, with the fix.
  if ! command -v jq >/dev/null 2>&1; then
    if [ "${HOOK_ALLOW_NO_JQ:-0}" = "1" ]; then exit 0; fi
    echo '{"decision":"block","reason":"jq is not installed, so the safety hooks cannot run. Ask the human to install jq (sudo pacman -S jq / brew install jq / apt install jq), or set HOOK_ALLOW_NO_JQ=1 to run unguarded."}'
    exit 2
  fi
  if [ "${HOOK_DEBUG:-0}" = "1" ]; then
    mkdir -p .devin
    printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$payload" >> .devin/hook-debug.log
  fi
}

# jq with several candidate field names; the first non-empty one wins.
field() { printf '%s' "$payload" | jq -r "$1 // empty" 2>/dev/null || true; }

block() {
  jq -n --arg r "$1" '{decision:"block", reason:$r}'
  exit 2
}

# Real-looking provider keys. Placeholders like ${NVIDIA_API_KEY} never match.
KEY_RE='nvapi-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|sk-or-v1-[0-9a-f]{20,}|sk-(proj-)?[A-Za-z0-9]{32,}'
PROVIDER_HOST_RE='integrate\.api\.nvidia\.com|generativelanguage\.googleapis\.com|openrouter\.ai/api|api\.openai\.com|api\.anthropic\.com'

# True if any tracked source file is newer than the last full verify.
source_newer_than_verify() {
  local stamp=.devin/.last-verify
  [ -f "$stamp" ] || return 0
  [ -n "$(find packages extensions scripts test agents config \( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name '*.json' \) \
        -not -path '*/node_modules/*' -not -path '*/out/*' -not -path '*/media/*' -newer "$stamp" 2>/dev/null | head -1)" ]
}
