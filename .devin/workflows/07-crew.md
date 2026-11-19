---
description: Turn on the crew - the lead agent definition, TrueForge dynamic subagents named by the lead, role parsing and enforcement at the approval pause, the board, the watchdog, and crew rows with brief/report bubbles
argument-hint: ""
---

# 07 Crew (A2 discovery, B4 "subagents visible in the session")

Goal: Task B on flask shows the lead's "Plan / Files" message, then 2–4 crew members, each with a name the lead
chose, a role chip, its brief (lead → member) and its report (member → lead). Then come the lead's edits to 3+
files, each paused for review. The TrueForge session page shows the same subagent threads.

## 1. The agent definition (`agents/co4fe3-coder.agent.json`, TS SDK field names)

```json
{
  "model": { "name": "$MODEL", "params": { "temperature": 0.2, "maxTokens": 4096, "parallelToolCalls": true } },
  "instructions": "<the lead text from rule 50, verbatim, as one JSON string with \\n line breaks>",
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

`buildSpec()` (`agent-core/src/forge/spec.ts`) fills in the placeholders. Its test asserts that no `$` placeholder
survives:

```ts
export function buildSpec(file: TrueForgeApi.AgentSpec, o: { model: string; editorServer: string; instructions?: string; contextLength?: number; crew?: boolean }): TrueForgeApi.AgentSpec {
  const spec = structuredClone(file);
  spec.model = { ...spec.model, name: o.model };
  if (o.instructions !== undefined) spec.instructions = o.instructions;
  spec.mcpServers = spec.mcpServers?.map((m) => (m.name === "$EDITOR" ? { ...m, name: o.editorServer } : m));
  if (spec.config?.dynamicSubAgents && o.crew === false) spec.config.dynamicSubAgents = { enabled: false };
  const c = spec.config?.contextManagement?.compaction;
  if (c?.enabled && o.contextLength) c.trigger = { type: "input_tokens", value: Math.floor(o.contextLength * 0.6) };
  return spec;
}
```

The setting `co4fe3.crew.enabled` (default `true`) maps to `crew`. With it off, the lead does everything itself. The
product must work both ways, because organisers may test a model that never delegates.

## 2. Crew state in the extension (`extensions/…/src/panel/crew.ts`)

```ts
export class Crew {
  private members = new Map<string, { title: string; role: Role }>();
  private w: WatchState = emptyWatch();
  /** Feed every TrueForge event. Returns a stop sentence when the watchdog trips (the caller aborts the turn with it). */
  onEvent(e: TfEvent): string | null {
    if (e.type === "thread.created") this.members.set(e.threadId, { title: e.title, role: parseRole(briefOf(e)) });
    const r = crewWatch(this.w, e); this.w = r.s;
    return r.stop;
  }
  member(threadId: string): { title: string; role: Role } | undefined { return threadId === "main" ? undefined : this.members.get(threadId); }
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

`crew/board.ts` (rule 50) plus two MCP tools. After every `board_write`, the extension pushes
`{ kind: "board", entries }`. The board is per session: a new chat starts empty.

## 4. Crew rows in the panel (`webview/src/components/MemberRow.tsx`)

```
● Find CLI registration      explore   running 4.2 s
  lead → Find CLI registration: "ROLE: explore. In src/flask/cli.py, find where the built-in commands run, shell and routes …"
  Find CLI registration → lead: "FlaskGroup.__init__ adds run_command, shell_command, routes_command (cli.py L560-L566) …"
```

Rules:
- The member title is exactly `thread.created.title`, never renamed.
- The role chip comes from `parseRole`; `general` shows no chip.
- Briefs and reports are collapsible, collapsed after 3 lines.
- The tool cards made by a member nest under its row (match on `threadId`).
- The lead's text rows stay at the top level.

## 5. Tests

- `roles.test.ts`: every role line form (`ROLE: explore`, `role: Edit`, inside the first 5 lines), and a missing role
  gives `general`.
- `policy.test.ts`: the `commandPolicy` table, `RepeatGuard` (the 3rd identical call refused, other turns
  unaffected), and `crewWatch` (stops at maxMembers + 2 and at maxToolCalls).
- `integration/crew.test.ts`, with the fake model:
  1. The main thread calls `create_sub_agent`, using the parameter names recorded in spike row 6.
  2. The subagent request (detect it by `ROLE: explore` in its messages) calls `propose_edit`. Assert that it is
     **denied** with the explore reason, and that the fake's next request in that thread contains the reason.
  3. The member then reports. Assert that `PanelEvent`s include the `member`, `to-<thread>` and `from-<thread>`
     messages, in that order.

## 6. Real run (Extension Development Host on `.cache/flask`, real model)

Run Task B exactly (rule 00 wording). Record in `docs/progress/07-crew.md`:
- how many members were spawned, with their titles, roles, durations and token counts;
- whether the lead's first message has "Plan / Files";
- the number of `propose_edit` calls and files;
- `pytest tests/test_cli.py -q` (run by the agent through `run_command` and by you in the terminal).

If the model never spawns members, that is acceptable (the product works without a crew). Note it, and say it in
the write-up honestly. If it spawns more than 4, tighten the lead text's wording, not the cap.

## Exit check

- Unit and integration crew tests green.
- One real Task B run recorded, with at least one member visible in the panel **and** in the TrueForge session page
  (take a screenshot of each for the write-up).
- Commit: `crew: lead and subagents via TrueForge with brief/report rows, roles and board`
