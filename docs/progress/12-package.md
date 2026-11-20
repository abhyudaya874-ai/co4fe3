# 12 — package: README, audits, .vsix, clean clone

## README.md rewritten (product-facing, workflow-12 §1 order)

what it is + GIF slot · requirements · clean-clone setup · agent definitions · use it · switch models ·
fork point · architecture diagram · tests · license.

## Audits (workflow §3 — both clean)

- `git ls-files | xargs grep` for `nvapi-*|AIza*|sk-or-v1-*|sk-*` → **nothing**
- `git log -p` for `nvapi-*|AIza*` → **nothing real** — the only hits are `scripts/hooks/test-hooks.sh`'s own
  synthetic pattern strings (a made-up key of 26 lowercase chars), used to prove the guards work. Not a leak.
- provenance (`KandD Labs|Glass Devtools|Part of V3Code`) → **nothing** outside the guard scripts' own patterns.

## .vsix

- `extensions/co4fe3-vscode/.vscodeignore` added (excludes src/test/webview-src/out-test/maps noise).
- `npm run build` → `npx @vscode/vsce package --no-dependencies` → `co4fe3.vsix` at repo root: **9 files, 1.24 MB**
  (package.json, media/{icon.svg,panel.css,panel.js}, out/extension.cjs). `*.vsix` is gitignored — the binary is a
  build artifact, not history.
- vsix install smoke: pending a normal VS Code install (human).

## Clean-clone test

`rm -rf /tmp/cc && git clone "$PWD" /tmp/cc && cd /tmp/cc && npm ci && npm run verify` — result below.

## PENDING THE HUMAN

- `code --install-extension co4fe3.vsix` in a normal VS Code + one Task A run.
- The README step "follow it in /tmp/cc up to the first inline edit" — walk it once.
