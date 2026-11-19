---
trigger: always_on
description: The TrueForge SDK surface co4fe3 uses, verified against @truefoundry/trueforge-sdk@0.185.0 .d.ts files and trueforge.dev, plus the traps that break it
---

# TrueForge

Sources (read 19 Nov 2026): trueforge.dev/api/quickstart, /api/use-agent (0.185.0 turn lifecycle), /create-agent/overview,
/models, /mcp-servers, /key-features/subagents, /key-features/deferred-tool-loading, and the unpkg `.d.ts` files of
`@truefoundry/trueforge-sdk@0.185.0` (`SessionsClient`, `BaseClient`, `ModelProvidersClient`, `AgentSpec`,
`RuntimeConfig`, `McpServer`, `ModelParams`, `ThreadCreatedEvent`, `ThreadDoneEvent`, `ModelMessageEvent`).
Anything not on this page is **UNVERIFIED**. Read the installed `.d.ts` in `node_modules/@truefoundry/trueforge-sdk/dist`
before using it, then add it here in the same commit.

## Pins

```jsonc
// package.json (root)
"scripts": {
  "trueforge": "npx --yes @truefoundry/trueforge@<PINNED>",      // workflow 00 fills <PINNED> from `npm view @truefoundry/trueforge version`
  "setup:trueforge": "node scripts/setup-trueforge.mjs"
},
// packages/agent-core/package.json
"dependencies": { "@truefoundry/trueforge-sdk": "0.185.0" }     // exact. 0.185.0 changed the turn lifecycle (pauses).
```

Local mode: one process, SQLite, no login, UI and API on `http://localhost:8790`. Keep it on localhost.
Interactive API docs: `http://localhost:8790/api/v1/docs`. OpenAPI JSON: `/api/v1/openapi.json`.

## Client (`agent-core/src/forge/client.ts`)

```ts
import { TrueForge } from "@truefoundry/trueforge-sdk";

/** No token in local mode. The 60 s default timeout would kill long SSE turns, so it is raised for streams only. */
export function makeClient(baseUrl: string): TrueForge {
  return new TrueForge({ baseUrl, timeoutInSeconds: 30, maxRetries: 1 });
}
/** Requests that create or change server state are never retried (the SDK default is 2 retries: duplicate turns). */
export const STREAM = { timeoutInSeconds: 600, maxRetries: 0 } as const;
export const ONCE = { timeoutInSeconds: 15, maxRetries: 0 } as const;

/** Cheap liveness probe used at activation and before every turn. */
export async function health(client: TrueForge, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    await client.models.list({ timeoutInSeconds: 3, maxRetries: 0, abortSignal: signal });
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
```

`BaseRequestOptions` (verified) has `timeoutInSeconds`, `maxRetries` (default 2), `abortSignal`, `headers`,
`queryParams`, `additionalBodyParameters`, `stream: { reconnectionEnabled, maxReconnectionAttempts }`.

## Sessions: inline spec, so the model can be switched (fallback needs it)

```ts
const { data: session } = await client.sessions.create({ agent: { spec } }, ONCE);   // spec: TrueForgeApi.AgentSpec
// switch model mid-session (inline sessions only; named sessions REJECT agent updates):
await client.sessions.update(session.id, { agent: { spec: { ...spec, model: { ...spec.model, name: fallbackFqn } } } }, ONCE);
await client.sessions.cancel(session.id, undefined, ONCE);            // idempotent; ends a running OR paused turn
```

`AgentSpec` fields (TS, camelCase): `model: { name, params? }`, `instructions?`, `mcpServers?`, `messages?`,
`responseFormat?`, `skills?`, `config?`. `RuntimeConfig`: `askUserQuestions`, `contextManagement`
(`compaction`, `largeToolResponse`), `dynamicSubAgents`, `generativeUi`, `iterationLimit` (1–1024, default 512),
`memory`, `sandbox`, `webSearch`. `McpServer`: `name`, `enableTools`, `disableTools`, `preload`, `preloadTools`,
`requireApprovalForTools`. `ModelParams`: `maxTokens`, `temperature`, `topP`, `topK`, `parallelToolCalls`,
`reasoningEffort`. Model FQN is `provider/model`.

## One turn, with pauses and cancel (`agent-core/src/forge/turn.ts`). Copy this; do not re-derive it.

```ts
import { TrueForge, TrueForgeApi, isEventDelta, mergeEventDelta } from "@truefoundry/trueforge-sdk";
import { STREAM } from "./client";

export type TfEvent = TrueForgeApi.TurnStreamingEvent;
export type EventIndex = Map<string, TfEvent>;
export interface PendingCall { threadId: string; toolCallId: string; kind: "approval" | "response"; call: TrueForgeApi.ToolCall | undefined }
export interface TurnHooks {
  /** Every event, after it is merged into `index`. Synchronous, never throws (wrap your own code in try/catch). */
  onEvent(e: TfEvent, index: EventIndex): void;
  /** The turn paused. Resolve with one answer per pending call. The user may take minutes. Reject when `signal` aborts. */
  onPause(pending: PendingCall[], index: EventIndex, signal: AbortSignal): Promise<TrueForgeApi.TurnUserEventMessage[]>;
}
export type TurnOutcome =
  | { status: "done"; turnId: string; output: string }
  | { status: "cancelled"; turnId?: string; reason: string }
  | { status: "error"; turnId?: string; previousTurnId: string | null; message: string; sawOutput: boolean };

export async function runTurn(i: { client: TrueForge; sessionId: string; text: string; previousTurnId?: string; signal: AbortSignal; hooks: TurnHooks }): Promise<TurnOutcome> {
  const index: EventIndex = new Map();
  let turnId: string | undefined;
  let prev: string | null = null;
  let lastEventId: string | undefined;
  let sawOutput = false;
  const stop = () => void i.client.sessions.cancel(i.sessionId, undefined, { timeoutInSeconds: 10, maxRetries: 0 }).catch(() => undefined);
  if (i.signal.aborted) return { status: "cancelled", reason: "client-cancelled" };
  i.signal.addEventListener("abort", stop, { once: true });
  const opts = { ...STREAM, abortSignal: i.signal };      // Stop ends the read at once, even if the server is slow
  try {
    let stream = await i.client.sessions.createTurnStream(i.sessionId, { input: [{ type: "user.message", content: i.text }], previousTurnId: i.previousTurnId ?? "auto" }, opts);
    for (;;) {
      const pending: PendingCall[] = [];
      let paused = false;
      for await (const e of stream) {
        lastEventId = e.id;
        if (isEventDelta(e)) { const base = index.get(e.id); if (base) mergeEventDelta(base, e); sawOutput = true; }
        else index.set(e.id, e);                            // a replayed event replaces the old copy: idempotent
        if (e.type === "turn.created") { turnId = e.turnId; prev = e.previousTurnId ?? null; }
        if (e.type === "tool.approval_required" || e.type === "tool.response_required")
          for (const ref of e.toolCalls) pending.push({ threadId: e.threadId, toolCallId: ref.id, kind: e.type === "tool.approval_required" ? "approval" : "response", call: findCall(index, ref.sourceEventId, ref.id) });
        try { i.hooks.onEvent(e, index); } catch { /* a UI bug must never kill the turn */ }
        if (e.type === "turn.update" && e.state.status === "paused") { paused = true; break; }
        if (e.type === "turn.done") return outcomeOf(e, turnId, prev, sawOutput);
      }
      if (!turnId) return { status: "error", previousTurnId: prev, message: "stream ended before turn.created", sawOutput };
      if (!paused) { stream = await i.client.sessions.subscribeToTurn(i.sessionId, turnId, { fromEventId: lastEventId }, opts); continue; } // dropped: resume
      const answers = await i.hooks.onPause(pending, index, i.signal);          // per-hunk review happens in here
      const resume = await i.client.sessions.subscribeToTurn(i.sessionId, turnId, { afterEventId: lastEventId }, opts); // subscribe FIRST
      await i.client.sessions.createTurnEvents(i.sessionId, turnId, { events: answers }, { timeoutInSeconds: 15, maxRetries: 0 });
      stream = resume;
    }
  } catch (err) {
    if (i.signal.aborted) return { status: "cancelled", turnId, reason: "client-cancelled" };
    return { status: "error", turnId, previousTurnId: prev, message: err instanceof Error ? err.message : String(err), sawOutput };
  } finally {
    i.signal.removeEventListener("abort", stop);
  }
}

export function findCall(index: EventIndex, sourceEventId: string, id: string): TrueForgeApi.ToolCall | undefined {
  const m = index.get(sourceEventId);
  return m?.type === "model.message" ? m.toolCalls?.find((c) => c.id === id) : undefined;
}

function outcomeOf(e: Extract<TfEvent, { type: "turn.done" }>, turnId: string | undefined, prev: string | null, sawOutput: boolean): TurnOutcome {
  const s = e.state;
  if (s.status === "done") return { status: "done", turnId: turnId ?? "", output: textOf(s.output?.content) };
  if (s.status === "cancelled") return { status: "cancelled", turnId, reason: s.reason };
  return { status: "error", turnId, previousTurnId: prev, message: s.message, sawOutput };
}

/** `content` is a string or an array of parts. VERIFY the part shape in ModelMessageEventContent.d.ts on first use. */
export function textOf(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p && typeof p === "object" && "text" in p && typeof p.text === "string" ? p.text : "")).join("");
  return "";
}
```

Answers sent from `onPause` (shapes verified in the use-agent cookbook):

```ts
const allow = (p: PendingCall): TrueForgeApi.TurnUserEventMessage => ({ type: "user.tool_approval", threadId: p.threadId, toolCallId: p.toolCallId, approval: { status: "allow" } });
const deny = (p: PendingCall, reason: string): TrueForgeApi.TurnUserEventMessage => ({ type: "user.tool_approval", threadId: p.threadId, toolCallId: p.toolCallId, approval: { status: "deny", reason } });
const reply = (p: PendingCall, content: string): TrueForgeApi.TurnUserEventMessage => ({ type: "user.tool_response", threadId: p.threadId, toolCallId: p.toolCallId, content });
```

## Events co4fe3 reads (TS fields are camelCase; the wire format is snake_case)

| `type` | Fields used | Used for |
|---|---|---|
| `turn.created` | `turnId`, `previousTurnId` | fallback retry branches from `previousTurnId` |
| `model.message` (+ `.delta`) | `threadId`, `content`, `reasoningContent`, `toolCalls[{id, function:{name, arguments}, toolInfo}]`, `usage{inputTokens, outputTokens, inputTokensBreakdown}` | text, thoughts, tool cards, context meter |
| `tool.response` | `threadId`, `toolCallId`, `content` | the tool card result |
| `tool.approval_required` | `threadId`, `toolCalls[{id, sourceEventId}]` | opens the review |
| `thread.created` | `threadId`, `title`, `parent{threadId, toolCallId}`, `agentInfo{type, name, input}` | crew member row + **brief** bubble |
| `thread.done` | `threadId`, `title`, `state{status, output, error}` | **report** bubble |
| `thread.context_compaction_started` / `_finished` | `threadId` | "context compacted" marker (visible B4) |
| `mcp.initialize` | `mcpServers[{name, transportType}]` | proves TrueForge reached our server |
| `turn.update` | `state.status` paused/running, `metrics` | spinner state |
| `turn.done` | `state`: `done{output, metrics}` · `cancelled{reason}` · `error{message}` | outcome, fallback trigger |

`toolInfo` is `{ type: "mcp", serverName, name }` for preloaded MCP tools, or `{ type: "truefoundry-system", name }`
for harness tools (`create_sub_agent`, and `call_tool`/`list_tools`/`get_tool_info` when tools are deferred).

## Registering our MCP server and the model providers

```ts
// on every activation (the port and token change per window)
await client.settings.mcpServers.createOrUpdate({
  manifest: {
    type: "remote",
    name: serverName,                          // ^[a-z][a-z0-9-]{0,62}[a-z0-9]$, e.g. "co4fe3-ws-3fa2c19b"
    url: mcp.url,                              // http://127.0.0.1:<port>/mcp
    description: "co4fe3 editor tools for one VS Code window: read, search, repo map, propose edits for review, run commands.",
    auth: { type: "header", headers: { Authorization: `Bearer ${mcp.token}` } },
  },
}, ONCE);
const tools = await client.mcpServers.listTools(serverName, ONCE);   // TrueForge itself calls our tools/list: end-to-end proof
```

```js
// scripts/setup-trueforge.mjs (keys come from env; the manifest shape is from ModelProvidersClient.d.ts)
await client.settings.modelProviders.createOrUpdate({ manifest: {
  type: "custom", name: "nvidia-nim", baseUrl: "https://integrate.api.nvidia.com/v1",
  auth: { apiKey: process.env.NVIDIA_API_KEY },
  models: [{ name: "nemotron-super", modelId: "nvidia/nemotron-3.5-super-vl-120b-a12b", properties: { contextLength: 131072, maxOutputTokens: 8192 } }],
} });
```

## Traps (each one has cost a team a demo)

1. **The SDK's 60 s default timeout** kills SSE turns. Use `STREAM` (600 s) on `createTurnStream` and `subscribeToTurn`.
2. **Its 2 default retries** can create a duplicate turn. Use `maxRetries: 0` on every POST that creates or changes state.
3. **One active turn per session.** Sending a message cancels the running turn (`cancelled-for-next-turn`). The
   composer's Send becomes Stop while a turn runs.
4. **Subscribe before answering a pause.** Open `subscribeToTurn({ afterEventId })`, then `createTurnEvents`, then read.
5. **After `cancel`, do not `break`.** The server sends a terminal `turn.done` and closes the stream. We also abort our
   read through `abortSignal`, so Stop is instant even when the server is slow.
6. **Named sessions reject agent updates.** co4fe3 uses inline-spec sessions, so fallback can switch the model.
7. **A retry must not duplicate the user message.** Retry a failed turn with `previousTurnId` set to the failed turn's
   own `previousTurnId`, or `"none"` if it was the root. Never use `"auto"`, which chains onto the failed turn.
8. **Deferred tools arrive as `call_tool`.** Our editor server is `preload: true`, so its calls arrive as real tool
   names with plain arguments, and the model saves discovery round trips (rule 60).
9. **`@write` / `@destructive` only match tools the server labels.** Gate by literal name:
   `requireApprovalForTools: ["propose_edit", "run_command"]`.
10. **Subagents nest one level, cannot ask the user, and the root waits for all of them.** Their approvals still pause
    the turn and carry their own `threadId`. Answer each pending call with its own `threadId`.
11. **MCP servers are remote only** (`type: "remote"`, streamable HTTP or SSE). That is why the extension hosts an HTTP
    MCP server on 127.0.0.1 with a bearer token.
12. **TrueForge skills and large-tool-response offloading need a sandbox** (Daytona). We run without one, so
    `largeToolResponse.enabled: false`, our tools cap their own output, and rules/skills load through our MCP tools
    (rule 85).
13. **No automatic model selection.** The roadmap lists it as planned, so fallback is ours (rule 70).
14. **`askUserQuestions` would stall Task B on a question.** It is off in both agent definitions.
