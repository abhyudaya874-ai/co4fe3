---
description: Make the repo judge-ready - README that works from a clean clone, example configs, agent definitions, licence, secrets audit, a .vsix, and a clean-clone test
argument-hint: ""
---

# 12 Package

Goal: a stranger with Node 22, VS Code and Python can clone the public repo and run all three tasks by following the
README, with no help and no keys in the repo.

## 1. README.md (repo root; this is what judges read first)

Sections, in this order:

1. **What it is**: three sentences and a GIF of Task A.
2. **Requirements**: Node ≥ 22.14, VS Code ≥ 1.90, Python ≥ 3.9 (for the flask demo), git, and an NVIDIA NIM key
   and a Gemini key (free tiers), or any OpenAI-compatible endpoint.
3. **Setup from a clean clone**:
   ```bash
   git clone https://github.com/<you>/co4fe3 && cd co4fe3
   npm ci
   npm run trueforge                         # terminal 1: TrueForge local on http://localhost:8790
   cp config/providers.example.json config/providers.json
   export NVIDIA_API_KEY=… GEMINI_API_KEY=…  # never written to disk by us
   npm run setup:trueforge                   # registers both providers in TrueForge
   npm run build
   code --extensionDevelopmentPath="$PWD/extensions/co4fe3-vscode" /path/to/flask   # or: install the .vsix
   ```
4. **Load the agent definitions**: co4fe3 creates sessions from `agents/co4fe3-coder.agent.json` and
   `agents/co4fe3-inline.agent.json` automatically. To see them in the TrueForge UI, run
   `node scripts/save-agents.mjs`. It stores both as saved agents through `client.agents.create`/`update`.
5. **Use it**: inline edit (Ctrl+Alt+K), the agent panel, the model picker, Undo, Stop.
6. **Switch models**: the status bar picker, or `co4fe3.models.order`, or add a provider in TrueForge.
7. **Fork point**: "Built from scratch. No upstream editor code. The architecture follows V3Code
   (github.com/HeavenFYouMissed/V3Code, Apache-2.0, commit 2eac91fb), reimplemented in our own code. Ideas (not code)
   from Cline, Continue, Aider and our own UltraPals project are credited in `NOTICE` and the write-up."
8. **Architecture**: the diagram from the pack README, plus links to `docs/DECISIONS.md` and `docs/LATENCY.md`.
9. **Tests**: `npm run verify`, and what it runs.
10. **Licence**: MIT.

## 2. Files that must exist

`LICENSE` (MIT); `NOTICE` (design credits, no third-party code); `config/providers.example.json` (no keys);
`.env.example` (no values);
`agents/co4fe3-coder.agent.json` and `agents/co4fe3-inline.agent.json`; `scripts/save-agents.mjs`; `docs/WRITEUP.md`.

## 3. Secrets audit (paste the output; it must print nothing)

```bash
git ls-files | xargs grep -nIE 'nvapi-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|sk-or-v1-[0-9a-f]{20,}|sk-[A-Za-z0-9]{32,}' || true
git log -p | grep -nE 'nvapi-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}' | head -5 || true
```

If either prints a line, **stop**. Rotate the key at the provider first, then rewrite history. Ask the human before
any history rewrite.

Provenance audit (rule 05). It must print nothing. `check-invariants.mjs` runs the same check on every verify:

```bash
git ls-files packages extensions scripts test | xargs grep -nIE 'KandD Labs|Glass Devtools|Part of V3Code' | grep -v check-invariants.mjs || true
```

## 4. The .vsix

```bash
npm run build
npx @vscode/vsce package --no-dependencies -o co4fe3.vsix   # the extension bundles its deps with esbuild
code --install-extension co4fe3.vsix                         # smoke: install into a normal VS Code, run Task A once
```

## 5. Clean-clone test (the real exit check)

```bash
rm -rf /tmp/cc && git clone "$PWD" /tmp/cc && cd /tmp/cc && npm ci && npm run verify
```

Then follow your own README in `/tmp/cc` up to the first inline edit. Fix every step that needed knowledge that is
not in the README.

## Exit check

- The secrets audit is empty; `npm run verify` is green in `/tmp/cc` with no `[verify] pending:` line; the README
  path reaches an inline edit.
- Commit: `docs: judge-ready README, example configs and agent definitions`
