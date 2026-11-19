---
description: Record the 4-minute video (A, B, C in order, verified on screen, TrueForge session shown), export the 1-3 page write-up PDF with the scorecard timestamps, and submit public links before 23:59 IST
argument-hint: ""
---

# 13 Submit (C1 video 10, C2 write-up 15)

Three artefacts, all public links, submitted through the Techfest portal **by 22:30 IST on Fri 20 Nov** (that leaves
90 minutes of buffer before the 23:59 deadline). A link that is not public at the deadline scores zero, and the
organisers will not ask for access.

## 1. The video (≤ 4:00, screen recording with the editor visible)

Settings: 1920×1080, 30 fps, editor font 15, the co4fe3 panel 520 px wide, notifications on, Do Not Disturb on for
the OS. Record each task as its own clip, then join them. Cutting **model waiting time is allowed**, but never cut
between giving an instruction and its diff appearing. Keep that stretch continuous, so use the fastest healthy model
(check the status bar TTFT first).

| Time | Beat | Must be legible on screen |
|---|---|---|
| 0:00–0:08 | title card | "co4fe3 · a VS Code agent on TrueForge · NIM primary, Gemini fallback" |
| 0:08–0:55 | **A**: select `get_debug_flag` → Ctrl+Alt+K → type the instruction → the diff streams → accept per hunk | the typed instruction; ✓/✗ per hunk |
| 0:55–1:05 | A verified: `FLASK_DEBUG=off python -c "…"` → `False` | the terminal output |
| 1:05–1:15 | Undo (B2): Undo → `git diff --stat` empty → re-accept | the toast and the empty diff |
| 1:15–1:25 | Stop (A3): run another inline edit, press Esc mid-stream → "Cancelled. Nothing was changed." → `git status` clean | instant stop, clean tree |
| 1:25–2:55 | **B**: type the instruction → the pack card (hold 2 s on the reasons) → crew rows → tool cards → 3+ proposals reviewed → pytest approval | file names, reasons, token bar, crew briefs/reports |
| 2:55–3:05 | TrueForge session page: turns, tool calls, subagent threads | the session page |
| 3:05–3:20 | B verified: `pytest tests/test_cli.py -q` passes; `flask config` masked JSON; `flask --help` lists `config`; `git diff --stat` shows 3+ files | the outputs |
| 3:20–3:55 | **C**: wrong NIM key in TrueForge → repeat A → the banner ("…rejected the API key… Answered by google-gemini/…") → type in another file meanwhile → `git status` clean → Reject all → clean | the banner text; the clean status |
| 3:55–4:00 | end card | repo URL |

Upload to YouTube as **Unlisted**, then open the link in a private window to confirm it plays.

## 2. The write-up (PDF, 1–3 pages, the 8 headings in order)

Fill in `docs/WRITEUP.md` (the skeleton is in the pack). Write the scorecard from the **final** video's timestamps,
one row per criterion, because judges check them. Export it:

```bash
npx --yes md-to-pdf docs/WRITEUP.md      # writes docs/WRITEUP.pdf; check it is ≤ 3 pages
```

Upload to Google Drive with "Anyone with the link can view", then open it in a private window.

## 3. The repository

- Public on GitHub. The README path works (workflow 12), and the latest commit has a green `npm run verify`.
- The repo contains `agents/*.agent.json`, `config/providers.example.json`, `LICENSE`, and no secrets (run the
  workflow 12 audit again).
- Add a repo description: "VS Code coding agent on TrueForge: inline edit, crew of subagents, per-hunk review,
  automatic model fallback".

## 4. Submit, then verify each link in a private window

| Artefact | Link | Opens logged out? |
|---|---|---|
| video | youtube.com/… | ☐ |
| write-up PDF | drive.google.com/… | ☐ |
| repo | github.com/… | ☐ |

## 5. Optional, after submitting: social posts (the contest window runs until 18 Dec)

One post per platform (LinkedIn, X, YouTube), each with the demo clip or link and the hashtags `#TrueForge`,
`#Forgeathon` and `#<YourTeamName>`. Tag TrueFoundry and Techfest. Submit the links through TrueFoundry's form when
it is shared (by 18 Dec). Organic engagement only.
