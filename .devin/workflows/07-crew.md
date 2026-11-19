---
description: Turn on the crew - the lead agent definition, modes mapped to enableTools, TrueForge dynamic subagents named by the lead, research/work profiles enforced at the approval pause, member status and evidence, the board, the watchdog, and crew rows with brief/report bubbles
argument-hint: ""
---

# 07 Crew (A2 discovery, B4 "subagents visible in the session")

Goal: Task B on flask shows:

1. the lead's "Plan / Files" message;
2. 2–3 crew members, each with a name the lead chose, a profile chip (research or work) and a live status, its brief
   (lead → member) and its report (member → lead);
3. the lead's edits to 3+ files, each paused for review.

The TrueForge session page shows the same subagent threads. Rule 50 is the spec; it follows V3Code's modes,
profiles, evidence and caps (`docs/study/v3code.md` §2–§5).

## 1. The agent definition (`agents/co4fe3-coder.agent.json`, TS SDK field names)

The file in the repo is the source. `check-invariants.mjs` requires its instructions to contain `PROFILE: research`,
`PROFILE: work`, `pack_context` and `At most 3 members`, so the lead text and `parseProfile` cannot drift apart.

```json
{
  "model": { "name": "$MODEL", "params": { "temperature": 0.2, "maxTokens": 4096, "parallelToolCalls": true } },
  "instructions": "<the lead text from rule 50 §7, verbatim, as one JSON string with \\n line breaks>",
  "mcpServers": [
    { "name": "$EDITOR", "preload": true, "enableTools": ["@all"], "requireApprovalForTools": ["propose_edit", "run_command"] }
  ],
  "config": {
    "askUserQuestions": { "enabled": false },
    "generativeUi": { "enabled": false },
    "dynamicSubAgents": { "enabled": true },
    "sandbox": { "enabled": false },
    "webSearch": { "enabled": false },
    "contextManagement": { "compaction": { "enabled": true }, "largeToolResponse": { "enabled": false } },
    "iterationLimit": 80
  }
}
```

`buildSpec()` (`agent-core/src/forge/spec.ts`) fills in the placeholders and applies the mode. Its test asserts that
no `$` placeholder survives and that ask/plan expose no gated tool:

```ts
export const MODE_TAIL: Record<Mode, string> = {
  agent: "",
  ask: "\nMODE: ask. Answer the question with file:line references. You cannot change files or run commands.",
  plan: "\nMODE: plan. Investigate, then end with a numbered plan: each step names the file, the change and how to verify it. You cannot change files or run commands.",
};

export function buildSpec(file: TrueForgeApi.AgentSpec, o: { model: string; editorServer: string; mode?: Mode; instructions?: string; contextLength?: number; crew?: boolean }): TrueForgeApi.AgentSpec {
  const mode = o.mode ?? "agent";
  const spec = structuredClone(file);
  spec.model = { ...spec.model, name: o.model };
  spec.instructions = (o.instructions ?? spec.instructions ?? "") + MODE_TAIL[mode];
  const tools = toolsForMode(mode);                                      // one map decides (rule 50 §1, V3Code availableTools)
  spec.mcpServers = spec.mcpServers?.map((m) => (m.name === "$EDITOR" ? {
    ...m, name: o.editorServer,
    enableTools: mode === "agent" ? ["@all"] : [...tools],
    requireApprovalForTools: Object.keys(APPROVAL).filter((t) => (tools as readonly string[]).includes(t)),
  } : m));
  if (spec.config?.dynamicSubAgents && o.crew === false) spec.config.dynamicSubAgents = { enabled: false };
  const c = spec.config?.contextManagement?.compaction;
  if (c?.enabled && o.contextLength) c.trigger = { type: "input_tokens", value: Math.floor(o.contextLength * 0.6) };
  return spec;
}
```

If TrueForge rejects an empty `requireApprovalForTools` list in ask/plan mode, record the error in
`docs/progress/07-crew.md` and omit the field for those modes. Never put a non-enabled tool there.

The setting `co4fe3.crew.enabled` (default `true`) maps to `crew`. With it off, the lead does everything itself. The
product must work both ways, because organisers may test a model that never delegates.

## 2. Crew state in the extension (`extensions/…/src/panel/crew.ts`)

```ts
interface MemberState { title: string; profile: Profile; status: MemberStatus; evidence: MemberEvidence; reason?: string }

export class Crew {
  private members = new Map<string, MemberState>();
  private w: WatchState = emptyWatch();
  constructor(private mode: Mode, private push: (e: PanelEvent) => void) {}

  /** Feed every TrueForge event. Returns a stop sentence when the watchdog trips (the caller aborts the turn with it). */
  onEvent(e: TfEvent): string | null {
    if (e.type === "thread.created") this.members.set(e.threadId, { title: e.title, profile: parseProfile(briefOf(e), this.mode), status: "running", evidence: emptyEvidence() });
    if (e.type === "thread.done") this.finish(e.threadId, textOf(e.state.output?.content), e.state.status !== "done");
    const r = crewWatch(this.w, e); this.w = r.s;
    return r.stop;
  }
  member(threadId: string): MemberState | undefined { return threadId === "main" ? undefined : this.members.get(threadId); }
  setStatus(threadId: string, status: MemberStatus): void { this.update(threadId, { status }); }
  record(threadId: string, add: Partial<MemberEvidence>): void {
    const m = this.members.get(threadId); if (!m) return;          // the lead has no row; its evidence is the checkpoint log
    const e = m.evidence;
    m.evidence = { proposals: e.proposals + (add.proposals ?? 0), hunksAccepted: e.hunksAccepted + (add.hunksAccepted ?? 0), hunksRejected: e.hunksRejected + (add.hunksRejected ?? 0), commands: e.commands + (add.commands ?? 0), filesChanged: [...new Set([...e.filesChanged, ...(add.filesChanged ?? [])])] };
  }
  /** thread.done: evidence decides completed vs blocked (rule 50 §4). */
  finish(threadId: string, report: string, failed: boolean): void {
    const m = this.members.get(threadId); if (!m || isTerminal(m.status)) return;
    const o = assessMemberOutcome({ profile: m.profile, report, evidence: m.evidence, failed });
    this.update(threadId, { status: o.status, reason: o.reason });
  }
  /** Stop: every non-terminal member becomes cancelled FIRST (V3Code abortRunning order). Returns the PanelEvents to push. */
  cancelAll(): PanelEvent[] {
    const out: PanelEvent[] = [];
    for (const [id, m] of this.members) if (!isTerminal(m.status)) { m.status = "cancelled"; out.push(this.row(id, m)); }
    return out;
  }
  private update(id: string, patch: Partial<MemberState>): void { const m = this.members.get(id); if (!m || isTerminal(m.status)) return; Object.assign(m, patch); this.push(this.row(id, m)); }
  private row(id: string, m: MemberState): PanelEvent { return { kind: "member", threadId: id, title: m.title, profile: m.profile, status: m.status, reason: m.reason }; }
}
```

`briefOf` lives in core (`agent-core/src/forge/events.ts`), because `fromForge` needs it too:

```ts
/** `agentInfo.input` per the docs; adapt to the AgentInfo.d.ts shape recorded in the spike (row 7). */
export const briefOf = (e: Extract<TfEvent, { type: "thread.created" }>): string =>
  typeof e.agentInfo?.input === "string" ? e.agentInfo.input : JSON.stringify(e.agentInfo?.input ?? "");
```

When `onEvent` returns a sentence, the turn controller pushes `{ kind: "marker", text: "Stopped: <sentence>" }` and
aborts the turn's controller. That is the same path as Stop, so the workspace stays consistent.

## 3. The board

`crew/board.ts` (rule 50 §5) plus two MCP tools. After every `board_write`, the extension pushes
`{ kind: "board", entries }`. The board is per session: a new chat starts empty.

## 4. Crew rows in the panel (`webview/src/components/MemberRow.tsx`)

```
● Find CLI registration      research   completed 4.2 s
  lead → Find CLI registration: "PROFILE: research. In src/flask/cli.py, find where the built-in commands run, shell and routes …"
  Find CLI registration → lead: "FlaskGroup.__init__ adds run_command, shell_command, routes_command (cli.py L560-L566) …"
⚠ Write the test             work       blocked — The report claims changes, but none of this member's edits were accepted.
```

Rules:

- The member title is exactly `thread.created.title`, never renamed.
- The profile chip comes from `parseProfile`.
- The status chip uses the `MemberStatus` vocabulary only. `waiting-approval` pulses; `blocked` shows its reason.
- Briefs and reports are collapsible, collapsed after 3 lines.
- The tool cards made by a member nest under its row (match on `threadId`).
- The lead's text rows stay at the top level.

## 5. Tests

- `modes.test.ts` (rule 50 §1) and `evidence.test.ts`:
  - a work member that claims "I updated cli.py" with 0 accepted hunks → `blocked`;
  - the same with 1 accepted hunk → `completed`;
  - a research member → never blocked;
  - all hunks rejected → `blocked` with the rejection reason;
  - `failed` → `failed`.
- `crewpolicy.test.ts`: the `commandPolicy` table, and `crewWatch` stops at the 9th member.
- `spec.test.ts`:
  - `buildSpec` in ask and plan exposes only `READ_ONLY` tools, has no gated tool and appends the mode tail;
  - agent mode keeps `@all` and both gated tools.
- `integration/crew.test.ts`, with the fake model:
  1. The main thread calls `create_sub_agent`, using the parameter names recorded in spike row 6, with a brief that
     starts `PROFILE: research`.
  2. The subagent request (detect it by `PROFILE: research` in its messages) calls `propose_edit`. Assert that it is
     **denied** with the profile reason, and that the fake's next request in that thread contains the reason.
  3. The member then reports. Assert that `PanelEvent`s include the `member` (running → completed), `to-<thread>`
     and `from-<thread>` rows, in that order.

## 6. Real run (Extension Development Host on `.cache/flask`, real model)

Run Task B exactly (rule 00 wording), in Agent mode. Record in `docs/progress/07-crew.md`:

- how many members were spawned, with their titles, profiles, final status, durations and token counts;
- whether the lead's first message has "Plan / Files";
- whether the lead used `pack_context`, and how many `read_file` calls it made;
- the number of `propose_edit` calls and files;
- `pytest tests/test_cli.py -q` (run by the agent through `run_command` and by you in the terminal).

Then run the same request in **Plan** mode. The lead must end with a numbered plan, and no review opens.

If the model never spawns members, that is acceptable (the product works without a crew). Note it, and say it in
the write-up honestly. If it spawns more than 3, tighten the lead text's wording, not the cap.

## Exit check

- Unit and integration crew tests green.
- One real Task B run recorded, with at least one member visible in the panel **and** in the TrueForge session page
  (take a screenshot of each for the write-up).
- Commit: `crew: modes, research/work profiles, evidence-checked members and board on TrueForge subagents`
