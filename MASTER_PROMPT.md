# Master prompt: build co4fe3

Three parts: what the human does before pasting (5 minutes), the prompt to paste into Devin, and a short resume
prompt for a new Devin session. The timebox and cut list are in `.devin/rules/95-commit-and-timebox.md`.

## Part 1. Before you paste (human)

1. **Clean tree.** `git -C /home/de3p/co4fe3 status --short` prints nothing. Commit the pack first if it does not.
2. **Keys, never committed.** Workflow 00 creates `.gitignore`, so ignore `.env` locally first, then write it in your editor:
   ```bash
   cd /home/de3p/co4fe3 && echo .env >> .git/info/exclude
   # .env holds two lines: NVIDIA_API_KEY=… and GEMINI_API_KEY=…  (Devin may not write it and must ask to read it)
   ```
3. **TrueForge in its own terminal** (the first run downloads the package; leave it running all night):
   ```bash
   cd /home/de3p/co4fe3 && npx --yes @truefoundry/trueforge@0.185.1
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8790/api/v1/docs   # 200
   ```
4. **Open Devin in `/home/de3p/co4fe3`** and paste Part 2.
5. **Stay reachable for permission prompts** in the first hour: `npm i` and `pip install` (workflow 00), reading
   `.env` (workflow 01), and edits to `.devin/rules/*` (workflow 01 corrects rule 20 against the real TrueForge).

What only you can check (Devin cannot see the screen). Devin writes each one as a `HUMAN CHECK:` line with exact steps:

| After workflow | You look at (Extension Development Host, `F5`) |
|---|---|
| 02 | status bar shows `TF ✓ 11 tools` |
| 03 | on minipkg `helpers.py`: CodeLens on each hunk, accept one, Undo restores it; a 10-second screen capture |
| 04 | Task A on `.cache/flask`, steps 1–7 of the workflow (accept, Undo, Stop, typing during the stream) |
| 05 | the panel streams, shows tool cards and member rows, Stop works |
| 06, 07 | Task B on flask: the pack card with ranks, crew briefs and reports, 3+ files reviewed |
| 08 | Task C twice: break the primary model, the banner names the fallback |
| 11–13 | rehearse A, B, C twice; record the video; export the write-up PDF; make the repo public; submit |

## Part 2. The prompt (paste everything inside the block)

````text
You are building co4fe3 in /home/de3p/co4fe3: a VS Code extension that is a coding agent whose agent loop runs on
TrueForge in local mode. The repo holds a complete build pack and no product code yet. Your job is to build the
product, workflow by workflow, until it passes the Round 1 judging tasks. Deadline: Fri 20 Nov 2026, 23:59 IST.
Feature freeze: Fri 18:00. You work through the night; the human answers prompts when awake.

## 0. Read first (in this order, before any command)

1. AGENTS.md
2. .devin/rules/90-small-model-protocol.md (how you must work)
3. every other file in .devin/rules/, from 00 to 95
4. docs/CODEMAP.md (headings now; look names up there every time you need one)
5. docs/study/v3code.md §15 (the adopt / adapt / skip table)

Precedence: rules > this prompt > your own ideas. If a rule and a task conflict, stop and ask. V3Code at
/home/de3p/V3Code is the reference architecture: read it for ideas, never copy, build or edit it (rule 05).

## 1. What done means

Judges run three fixed tasks on pallets/flask 3.1.3, with the exact wording in rule 00:
- Task A: inline edit of get_debug_flag; the diff streams into a diff editor; accept hunk by hunk; Undo works.
- Task B: agent mode, no files named; the panel shows the context pack (files, reasons, ranks, tokens), the crew's
  briefs and reports and tool cards; edits to 3+ files pause for per-hunk review; tests pass; the TrueForge session
  link is shown.
- Task C: break the primary model and repeat A; a banner names the failure and the fallback; the workspace stays
  clean until a hunk is accepted.
The eligibility gate in rule 00 is pass/fail and is checked before any points. Never break a row of it.

## 2. The run order

Run /start-session (.devin/workflows/start-session.md) and fill in its 7-line block. Then run the workflows in
.devin/workflows/ in this order, without waiting for a reply between them:

00-bootstrap → 01-trueforge-spike → 02-mcp-server → 03-review-core → 04-inline-edit → 05-agent-panel → 06-context
→ 07-crew → 08-models-fallback → 09-latency → 10-instructions → 11-rehearse → 12-package → 13-submit

For each workflow, do exactly this:

a. CLOCK. Run `date`. Compare with the matching row of the rule 95 timebox. If you are more than 2 hours behind,
   cut from the rule 95 cut list in order, write each cut in docs/BACKLOG.md, and say so in the report.
   Never cut Task A, B or C, or anything on the "Never cut" line.
b. READ the whole workflow file and every rule section it cites. Restate its goal and exit check in 3 lines.
c. SLICE. Split the work into slices of at most 2 files and about 80 changed lines. For each slice:
   - write the 4-line box from rule 90 (GOAL / FILES / PATTERN / CHECK);
   - look up every name in docs/CODEMAP.md, rule 20 or the installed .d.ts (never from memory); if a name does not
     exist, create it deliberately and add it to CODEMAP in the same commit;
   - write the failing test first when the workflow lists one (rule 80 "Tests that must exist");
   - edit, then run `npm run verify:fast`; fix the first error first.
d. EVIDENCE. Run every exit-check command and paste the raw output into docs/progress/NN-<name>.md (use the file
   name the workflow gives, else NN-<workflow name>.md), in this shape:

   # NN <name>
   ## Exit check
   - [x] <item> — `<command>` → <the line that proves it>
   - [ ] HUMAN CHECK: <item> — steps: <exact clicks> — expected: <what the human should see>
   ## Raw output
   <pasted output>
   EXIT: passed (HH:MM)

   The last line is written only when every automated item is [x]. If human checks are still open, the last line
   is `EXIT: passed (HH:MM) · AWAITING HUMAN: <items>`. scripts/verify.mjs reads that line: from then on the
   workflow's test stage (integration after 01, e2e after 04, perf after 09) can never be "pending" again.
e. GATE AND COMMIT. Run `npm run verify` (it must end `verify: all stages passed`), then commit in the rule 95
   format. Several green commits per workflow are fine. Use `git add <paths>`, never `git add -A`.
f. REPORT, then start the next workflow at once:

   WORKFLOW: NN-name — passed | passed, awaiting human | blocked
   TIME:     HH:MM — timebox row "<row>": on track | behind by <h> (cut: <items>)
   EVIDENCE: docs/progress/<file> · verify: all stages passed (pending: <stages or none>) · <sha> <subject>
   HUMAN:    none | <one action> — needed by <workflow/step> — meanwhile I <what you continue with>
   NEXT:     <NN-name>, step <n>

You move to the next workflow only when every automated exit item passes. Open HUMAN CHECKs do not hold you
back; a failing automated item always does.

## 3. What only the human can do (ask, then keep working)

- Approve permission prompts: npm i, pip install, reading .env, edits to .devin/rules/*, scripts/hooks/*,
  scripts/verify.mjs or scripts/check-invariants.mjs.
- Keep TrueForge running. If `curl -s -o /dev/null -w "%{http_code}" http://localhost:8790/api/v1/docs` prints 200,
  it is already running: never start a second one. If it does not, ask the human to run `npm run trueforge` in a
  terminal. Meanwhile, do the unit-tested slices that need no server.
- Put keys in .env. You never write .env, never print a key and never put one on a command line.
- Watch the Extension Development Host. You cannot see the screen. Your evidence is the integration and e2e tests;
  the human's is the HUMAN CHECK steps you write for them.
- Record the video, export the write-up PDF, create and publish the GitHub repo, submit the links (12, 13).

Ask in one line: `HUMAN: <one action> — needed by <workflow/step> — meanwhile I <what you continue with>`.

## 4. Hard rules (the files are authoritative; these are the ones that bite)

- TrueForge runs the loop. No provider hostname or provider SDK in packages/ or extensions/ (law 1).
- packages/agent-core never imports vscode (law 2). Only extensions/co4fe3-vscode/src/review/apply.ts writes
  workspace files (law 3). Nothing reaches disk before a person accepts a hunk (law 4).
- Workflow 00 installs every dependency at pinned versions. Never add or upgrade one; if you think you must, stop
  and ask with the reason, size and licence.
- Never edit a check, a test or a hook to get green, never pass --no-verify, never skip a verify stage. If you
  believe a check is wrong, stop and say why.
- Same error twice: stop and write tried / saw / now suspect (3 lines), then re-plan or ask.
- Wherever real TrueForge behaviour differs from rule 20, record it in docs/progress/01-spike.md and fix rule 20 and
  the code in the same commit.
- Do not refactor "while you are here" and do not add features no workflow asks for. Write them in docs/BACKLOG.md.

## 5. Facts from the bootstrap dry run (19 Nov, 20:50 IST), so you do not rediscover them

- At the end of workflow 00, `npm run verify` prints `pending` for perf, integration and e2e. That is expected
  (rule 80, "Pending stages"); commits are allowed. A stage runs as soon as its inputs exist.
- TypeScript is 7.x. A CSS side-effect import needs webview/src/vite-env.d.ts (workflow 00 creates it).
- npm 11 warns that esbuild's postinstall script is not approved. esbuild works anyway; do not approve scripts.
- Vite warns "ESM syntax in a file loaded as CommonJS" for webview/vite.config.ts. Harmless; do not add "type".
- Node 26.7 imports .ts files directly (type stripping). Do not install tsx.
- check-invariants scans every tracked file for key-shaped strings. A test that needs a fake key builds it at run
  time, as scripts/hooks/test-hooks.sh does with FAKE_KEY.
- Still unverified until workflow 01 runs: TrueForge failure strings, MCP tool naming (prefixed or not), the
  create_sub_agent parameters, the AgentInfo.input type, the session URL pattern, the models.list shape, and
  whether an empty requireApprovalForTools is accepted. The spike decides each one; do not assume.

## 6. Helpers that build co4fe3 (.devin/agents/)

- forge-scout: read .d.ts files, docs and V3Code; answer one question. No writes. At most 3 in parallel.
- forge-editor: implement one slice (2 files at most). Never two editors on the same file.
- forge-verifier: run the gate and report failures, after every editor.
- forge-reviewer: adversarial review before the last commit of each workflow.
- forge-oracle and the orchestrate skill: when a slice needs more than 2 files or has more than 1 unknown.

## 7. When to stop

Stop and wait only for: a BLOCKED item (two strikes, a rule conflict, a hook that blocks the same action twice), a
permission prompt, or the end of the run. The run ends when workflow 12's automated items pass and workflow 13's
checklist is prepared for the human, with every remaining human step listed in the last report.

Start now: run /start-session, fill in its block, then begin workflow 00 at step 1.
````

## Part 3. Resume prompt (new Devin session, or after Devin loses context)

````text
Resume building co4fe3 in /home/de3p/co4fe3. Re-read MASTER_PROMPT.md Part 2 and follow it exactly. Run
/start-session and fill in its block. Then open the newest docs/progress/NN-*.md: if its last line is not
"EXIT: passed …", continue that workflow at its first unchecked automated exit item; otherwise start workflow NN+1
at step 1. Run `git status` first. If there are uncommitted changes, run `npm run verify:fast` and finish or revert
only your own slice before anything else.
````
