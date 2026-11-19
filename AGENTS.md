# co4fe3

A VS Code coding agent whose agent loop runs on **TrueForge** (github.com/truefoundry/trueforge, local mode).
Entry for the Techfest 2026-27 TrueFoundry Forge-a-thon. Judges score behaviour on screen, on `pallets/flask` 3.1.3,
in three fixed tasks: **A** inline edit, **B** agent mode across 3+ files nobody named, **C** resilience when the model
fails. Stack: TypeScript strict, npm workspaces, VS Code extension API, React webview (Vite), vitest.
Its architecture follows **V3Code** (`/home/de3p/V3Code`, an Apache-2.0 editor built on Void) wherever the
extension API allows: runtime policy, modes and subagent profiles, an evidence-checked crew, RRF retrieval, an
LSP-backed context pack, and verify-after-apply. Ideas only, no copied code (rule 05).

**Deadline: 2026-11-20 23:59 IST.** All artefacts (video, write-up PDF, GitHub repo) must be public links by then.
Every decision is measured against one question: does this survive to the demo video?

You are probably a small model. Read `.devin/rules/90-small-model-protocol.md` first. It is short and it saves you.

## The eight laws (a hook, `scripts/check-invariants.mjs` or a test enforces each one)

1. **TrueForge runs the loop.** No code in `packages/` or `extensions/` calls a model provider. No provider hostname,
   no `openai` / `@google/genai` / `@anthropic-ai/sdk` import. Models are configured in TrueForge only.
2. **`packages/agent-core` imports nothing from `vscode`.** The extension injects an `EditorHost`; tests inject a fake.
3. **One write path.** Only `extensions/co4fe3-vscode/src/review/apply.ts` writes workspace files.
4. **Nothing reaches disk before a person accepts a hunk.** `propose_edit` writes only hunks that were accepted for
   that exact proposal. No decision means nothing is written. Every apply records a checkpoint, and Undo restores exact bytes.
5. **Cancel leaves the workspace consistent.** A file is written whole or not at all, and undecided proposals are
   dropped when the turn ends.
6. **Never write an SDK method, event field, endpoint or setting from memory, and never copy V3Code or Void
   code.** Our names are in `docs/CODEMAP.md`. TrueForge names are in `.devin/rules/20-trueforge.md`. For anything
   else, read the installed `.d.ts` first (`research-web` skill). V3Code (`/home/de3p/V3Code`) is the reference
   architecture: read it for ideas, reimplement them in our own code (rule 05).
7. **No secrets in git.** Keys go in environment variables and TrueForge settings, and nowhere else. The repo ships
   `config/providers.example.json`.
8. **`npm run verify` is green before every commit.** A hook blocks `git commit` otherwise.

## Read order (new session, or after losing context)

1. `/start-session` (it runs steps 2–4 for you and reports state)
2. `docs/CODEMAP.md`: every file, its exports and their exact signatures. **Do not invent names. Look them up here.**
3. `docs/PATTERNS.md`: copyable recipes for the things you will actually do.
4. `docs/ANTI-PATTERNS.md`: wrong → right pairs. Scan it before you report done.

## Where things live

| Need | Go to |
|---|---|
| What we build, the scoring map, what to cut | `.devin/rules/00-mission.md` |
| The reference architecture (V3Code): what we copy as ideas, never as code | `.devin/rules/05-reference-v3code.md`, `docs/study/v3code.md` |
| Layers, package boundaries, the single write path | `.devin/rules/10-architecture.md` |
| The TrueForge SDK surface (verified) and its traps | `.devin/rules/20-trueforge.md` + `trueforge-sdk` skill |
| Hunks, approval → review, checkpoints, undo, cancel, path jail | `.devin/rules/30-review-and-safety.md` |
| Repo map, context pack, budget, @mentions | `.devin/rules/40-context.md` |
| The runtime crew (lead + subagents), brief/report, board | `.devin/rules/50-crew.md` |
| Latency budgets and how to measure them | `.devin/rules/60-latency.md`, `docs/LATENCY.md`, `latency-probe` skill |
| Providers, model fallback (Task C) | `.devin/rules/70-models.md` |
| Tests, the fake model server, fixtures | `.devin/rules/80-testing.md` |
| The product reading AGENTS.md / rules / workflows / skills | `.devin/rules/85-instructions.md` |
| How to behave as a small model | `.devin/rules/90-small-model-protocol.md` |
| Commit format, the timebox, the cut list | `.devin/rules/95-commit-and-timebox.md` |
| VS Code API recipes (diff editor, CodeLens, webview CSP) | `vscode-extension` skill |
| Why a choice was made | `docs/DECISIONS.md` |
| Step-by-step procedures | `.devin/workflows/*` |

## Default loop

`/explore-codemap` → `/ship-slice` → `/verify-loop` → `/review-diff` → commit.
More than 2 files, or more than 1 unknown → `/orchestrate`. A known procedure → its numbered workflow.

## Subagents that BUILD co4fe3 (Devin profiles in `.devin/agents/`)

| Profile | Use for | Writes? |
|---|---|---|
| `forge-scout` | reading, tracing, reading `.d.ts` files and docs | no |
| `forge-editor` | implementing ONE slice | yes, ≤ 2 files |
| `forge-verifier` | running the gate, reporting failures | no source edits |
| `forge-reviewer` | adversarial review before a commit | no |
| `forge-oracle` | coordinating the four above | delegates only |

Do not confuse these with the **runtime crew** inside the product (a lead agent plus subagents that TrueForge spawns,
named by the lead). The runtime crew is specified in `.devin/rules/50-crew.md`.

## Commands

```bash
npm run verify:fast        # check-invariants + typecheck + vitest unit (~15 s). After every edit.
npm run verify             # + integration (real TrueForge + fake model) + extension build. Writes .devin/.last-verify.
npm run verify:live        # + latency bench and a smoke turn against your real models (needs keys). Before recording.
node scripts/check-invariants.mjs
bash scripts/hooks/test-hooks.sh                          # the guards themselves (also a verify stage)
npx vitest run packages/agent-core/test/hunks.test.ts     # one file
npm run trueforge          # starts TrueForge local on :8790 (pinned version)
npm run setup:trueforge    # registers providers from config/providers.json + env keys
```

## Definition of done

`npm run verify` printed `verify: all stages passed`. Review findings are fixed or written into `docs/BACKLOG.md`.
The commit uses the house format (rule 95). You answered the 7-point self-review in rule 90.
For anything a judge sees, you watched it work in the Extension Development Host. "It should work" is not done.

## When stuck

Same error twice → STOP. Write *tried / saw / now suspect* (3 lines), then re-plan or ask.
Never edit a check, a test or a hook to get green.
