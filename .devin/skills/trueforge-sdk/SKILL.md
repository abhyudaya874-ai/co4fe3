---
name: trueforge-sdk
description: Recipes for every TrueForge call co4fe3 makes - client, inline-spec sessions, streaming turns with pauses, cancel, model switching, MCP and provider registration, saved agents - and how to verify a name in the installed SDK
argument-hint: "<the TrueForge thing you need>"
agent: forge-editor
triggers:
  - user
  - model
---

Need: $ARGUMENTS

Rule 20 holds the canonical code (`runTurn`, `makeClient`, the traps). This skill is the index into it, plus the
recipes rule 20 does not repeat.

## 0. Verify a name before using it (30 seconds, every time)

```bash
ls node_modules/@truefoundry/trueforge-sdk/dist/cjs/api/types/ | grep -i <Thing>             # e.g. AgentInfo, TurnUserEventMessage
sed -n '1,80p' node_modules/@truefoundry/trueforge-sdk/dist/cjs/api/types/<Thing>.d.ts
grep -n "<method>(" node_modules/@truefoundry/trueforge-sdk/dist/cjs/api/resources/*/client/Client.d.ts
```

Not installed yet? The same files are on unpkg:
`https://unpkg.com/@truefoundry/trueforge-sdk@0.185.0/dist/cjs/api/types/<Thing>.d.ts`. TS fields are camelCase;
docs and wire JSON are snake_case.

## 1. Which call for which job

| Job | Call | Notes |
|---|---|---|
| health | `client.models.list(opts)` | 3 s timeout, 0 retries |
| list models for the picker | `client.models.list()` | record the response shape once (spike) |
| new chat / inline edit | `client.sessions.create({ agent: { spec } }, ONCE)` | inline spec, never `{ name }` (model switching) |
| a turn | `runTurn(...)` (rule 20) | wraps `createTurnStream` + pauses + cancel |
| answer a pause | subscribe `afterEventId` → `createTurnEvents` → read | in `runTurn` |
| stop | `client.sessions.cancel(id, undefined, ONCE)` + abort our read | idempotent |
| switch model | `client.sessions.update(id, { agent: { spec } }, ONCE)` | inline sessions only |
| retry after a failed turn | `previousTurnId: failed.previousTurnId ?? "none"` | never `"auto"` |
| register the editor tools | `client.settings.mcpServers.createOrUpdate({ manifest })` | every activation |
| prove TrueForge reaches them | `client.mcpServers.listTools(name)` | TrueForge calls our `tools/list` |
| register providers | `client.settings.modelProviders.createOrUpdate({ manifest })` | `scripts/setup-trueforge.mjs` |
| show agents in the UI | `client.agents.create/update` | `scripts/save-agents.mjs` |
| replay a finished turn | `client.sessions.listTurnEvents(sid, tid)` | deltas come pre-merged |

## 2. Saved agents for the TrueForge UI (`scripts/save-agents.mjs`)

```js
import { readFileSync } from "node:fs";
import { TrueForge } from "@truefoundry/trueforge-sdk";
const client = new TrueForge({ baseUrl: process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790", maxRetries: 0 });
const servers = await client.settings.mcpServers.list();                                    // VERIFY response shape on first run
const editor = JSON.stringify(servers).match(/co4fe3-ws-[0-9a-f]{8}/)?.[0];
if (!editor) { console.error("Open a workspace with co4fe3 running first (it registers co4fe3-ws-<hash>)."); process.exit(2); }
const order = JSON.parse(readFileSync("config/providers.example.json", "utf8")).order;
for (const [name, file, description] of [["co4fe3-coder", "agents/co4fe3-coder.agent.json", "co4fe3 agent mode: lead + crew, editor tools, per-hunk review"], ["co4fe3-inline", "agents/co4fe3-inline.agent.json", "co4fe3 inline edit: one streamed replacement, no tools"]]) {
  const manifest = JSON.parse(readFileSync(file, "utf8").replaceAll("$MODEL", order[0]).replaceAll("$EDITOR", editor));
  const existing = [];
  for await (const a of await client.agents.list({ agentName: name })) existing.push(a);       // agents.list is a paginated Page
  const hit = existing.find((a) => a.name === name);
  if (hit) await client.agents.update(hit.id, { manifest }); else await client.agents.create({ name, description, manifest });
  console.log(`${hit ? "updated" : "created"} ${name}`);
}
```

`agentName` is the docs' `agent_name` substring filter, written camelCase. Check it in `ListAgentsRequest.d.ts`.

## 3. Event-index helpers you will want

```ts
/** Text of a merged model.message for one thread, or "". */
export const messageText = (index: EventIndex, id: string): string => { const m = index.get(id); return m?.type === "model.message" ? textOf(m.content) : ""; };
/** Our tool name for a pending call, or null when it is not our editor server. Handles preloaded and deferred forms. */
export function toolNameOf(call: TrueForgeApi.ToolCall | undefined, server: string): string | null {
  if (!call) return null;
  if (call.toolInfo.type === "mcp") return call.toolInfo.serverName === server ? call.toolInfo.name : null;
  if (call.toolInfo.name !== "call_tool") return null;
  const a = safeJson(call.function.arguments) as { mcp_server?: string; tool_name?: string } | null;
  return a?.mcp_server === server ? a.tool_name ?? null : null;
}
```

## 4. Things that look right and are wrong

- `for await (const { data: e } of stream.withMetadata())` mixed with `for await (const e of stream)`: pick one.
  co4fe3 uses the plain form everywhere.
- A `break` after `cancel()`: the server sends `turn.done`; we abort our own read instead.
- `maxRetries` left at its default on `createTurnStream`, `createTurnEvents` or `cancel`. Always use 0.
- Writing snake_case keys into a TS spec object (`mcp_servers`). The TS SDK wants `mcpServers`. Our
  `agents/*.json` are already camelCase.
