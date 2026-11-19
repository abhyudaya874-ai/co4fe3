# 01 TrueForge spike

Ran against a dedicated spike instance of the same pinned build (`@truefoundry/trueforge@0.185.1`, free port, temp
SQLite) because the human's `:8790` instance was not up yet. Same version, same behaviour; the real provider setup is
re-run on :8790 the moment it answers 200. Keys came from `.env` via `set -a; . ./.env; set +a`.

## Step 1 — providers registered

```
ok   nvidia-nim: nemotron-super, nemotron-ultra
ok   google-gemini: gemini-flash-lite

TrueForge at http://localhost:41890 serves:
[{"name":"google-gemini/gemini-flash-lite","modelId":"gemini-3.5-flash-lite","provider":{"name":"google-gemini"},"properties":{"contextLength":1048576,"maxOutputTokens":8192},"warning":"Reasoning effort is not configured for this model, which may affect TrueForge's performance."},
 {"name":"nvidia-nim/nemotron-super","modelId":"nvidia/nemotron-3.5-super-vl-120b-a12b",...}]
```

FQNs match `config/providers.example.json` `order` — no change needed. The `warning` about reasoning effort is
recorded for workflow 08 (`reasoningEffort` is only set on models that list it, rule 60 lever 6).

## Row 1 — text turn (`node scripts/spike.mjs text`)

Event order: `turn.created` → `model.message` → `model.message.delta`* → `turn.done`.

| model | session | turn.created | first delta | turn.done |
|---|---|---|---|---|
| google-gemini/gemini-flash-lite | 52 ms | 114 ms | **63,518 ms** | 63,541 ms |
| nvidia-nim/nemotron-super | 85 ms | 190 ms | **1,834 ms** | 2,886 ms |

`turn.created` carries `turnId` and `previousTurnId: null` (root turn). `turn.done.state.output.content` holds the
final text; `reasoningContent` is separate. **Finding:** gemini-flash-lite's first token took 63.5 s on this call
(rule 70 expects 0.8–2 s) — possibly the `AQ.`-style key doing a token exchange, or free-tier queueing. NVIDIA
matches its measured profile. The bench (workflow 08/09) decides the real order; the fallback design already covers
a slow primary (stall watchdog + hedge).

## Row 2 — MCP tool call (`… tool`)

```
56ms tools seen by TrueForge: {"data":[{"name":"ping","description":"…","inputSchema":{…draft-07…},"annotations":{"readOnlyHint":true},"execution":{"taskSupport":"forbidden"},"preload":true}]}
185ms mcp.initialize main {"mcpServers":[{"name":"co4fe3-spike","id":"co4fe3-spike","transportType":"streamable-http"}]}
2809ms MCP ping called with hi                      ← our handler ran
2827ms tool.response main {"toolCallId":"call-5c66203c-…","content":"pong: hi","threadId":"main"}
3616ms turn.done … "The ping tool returned: **pong: hi**"
```

TrueForge listed our tool over HTTP, called it, and the result came back as `tool.response` with our text. The
`toolInfo` of the call (from the approval row below): `{ type: "mcp", name: "ping", serverId: "co4fe3-spike",
serverName: "co4fe3-spike" }` — both `serverId` and `serverName` are present.

## Row 3 — approval gate (`… gate`)

```
1311ms tool.approval_required main {"toolCalls":[{"id":"call-1433b580-…","sourceEventId":"01m7t9qewabbanrk2f37s72hqm"}]}
1312ms turn.update {"state":{"status":"paused","metrics":{"totalInputTokens":494,"totalOutputTokens":51,…}}}
1318ms APPROVAL for {"type":"mcp","name":"ping","serverId":"co4fe3-spike","serverName":"co4fe3-spike"} {"text":"hi"}
1357ms turn.update {"state":{"status":"running"}}      ← after subscribeToTurn + createTurnEvents(allow)
2352ms turn.done (done)
```

Matches rule 20 exactly: pause shape, `sourceEventId` for `findCall`, subscribe-then-send resumes the turn.

## Row 4 — cancel (`… cancel`)

```
2608ms cancel()
2636ms turn.done {"state":{"status":"cancelled","reason":"client-cancelled",…}}
```

28 ms from `cancel()` to `turn.done`. The server closes the stream after the terminal event, as rule 20 trap 5 says.

## Row 5 — failure strings (`… fail`)

```
1136ms FAILURE STRING: {"status":"error","message":"[Model Error] Request failed (403): Forbidden","completedAt":"…","metrics":{…0 tokens}}
1172ms FAILURE STRING: {"status":"error","message":"[Model Error] Cannot connect to API: bad port","completedAt":"…"}
```

- Bad key → HTTP **403** (not 401) from NIM: `Request failed (403): Forbidden`. Rule 70's auth regex already covers
  `\b(401|403)\b`.
- Unreachable → `Cannot connect to API: bad port`. **Rule 70 fixed in this commit:** `cannot connect` added to the
  unreachable regex (it was not matched before; it would have classified as `unknown`).
- Both arrive as a normal `turn.done` with `state.status: "error"` — the SDK does not throw; `runTurn`'s outcome
  path handles them. ~1.1–1.2 s to fail.

## Row 6 — fake model + harness tools (`… fake`)

```
REQ POST /chat/completions keys: model,messages,tools,tool_choice,stream,stream_options
  tools: get_current_datetime, create_sub_agent
  create_sub_agent schema: {"type":"object","properties":{"name":{"type":"string","minLength":1},"input":{"type":"string","minLength":1}},"required":["name","input"]}
```

- TrueForge calls `POST /chat/completions` with `stream: true` and `stream_options`.
- Harness tools with `dynamicSubAgents: { enabled: true }`: `get_current_datetime`, `create_sub_agent`.
- `create_sub_agent` takes exactly `{ name, input }` — the lead names the member; `input` is the brief.
- MCP tool naming: our preloaded tools arrive as their **bare names** (row 2's `ping`); the fake's `toolName()`
  helper still tolerates prefixes for safety.

## Row 7 — real model, two subagents (`… subagents`)

```
2557ms thread.created e9e1b99d-… {"agentInfo":{"type":"dynamic","name":"colour-agent","input":"You are a sub-agent. …"},…}
2557ms thread.created 2cd6534c-… {"agentInfo":{"type":"dynamic","name":"number-agent","input":"…"},…}
3791ms thread.done 2cd6534c-… {"parent":{"toolCallId":"call-0c96f054-…","threadId":"main"},"threadId":"2cd6534c-…","title":"number-agent","state":{"status":"done","output":{…}}}
3840ms thread.done e9e1b99d-… {"title":"colour-agent","state":{"status":"done",…}}
4748ms final: "- Colour: Blue\n- Number: 1"
```

Both members ran in parallel, one level deep, and the lead waited for both. `ThreadCreatedEvent.title: string` and
`AgentInfo.input: string` verified in the installed `.d.ts` (`ThreadCreatedEvent.d.ts`, `AgentInfo.d.ts`) — rule 50's
`fromForge` code is correct as written.

## Row 8 — session URL pattern

The UI's route table (frontend bundle): `session: "/sessions/:sessionId"`, `sessionsBrowser: "/sessions"`. So

```
sessionUrl(base, id) = `${base}/sessions/${id}`        e.g. http://localhost:8790/sessions/01m7t9sawnqy56rb7c6rnpnphr
```

- [x] automated: pattern extracted from the served frontend and the sessions API (`GET /api/v1/sessions` lists ids)
- [ ] HUMAN CHECK: open http://localhost:41890/sessions/01m7t9sawnqy56rb7c6rnpnphr in a browser (instance is up
      until the spike record is committed) — expected: the session transcript renders. Steps: open the URL, look at
      the "Use two subagents…" session.

## Deviations from rule 20 (fixed in rule 20 in this commit)

1. **SSRF guard (new trap 16):** TrueForge refuses outbound fetches to `127.0.0.1`/`::1`/`localhost`/private CIDRs.
   Our MCP server lives on loopback, so `npm run trueforge` now sets
   `OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1","localhost"]'`. Without it: `Outbound URL blocked for host "127.0.0.1"`.
2. **Bind address:** the server binds `::1` only; client base URLs must be `http://localhost:<port>`, never
   `127.0.0.1` (noted in rule 20's local-mode paragraph).
3. **Name validation (new trap 17):** `manifest.models[].name` must be 2–64 lowercase chars.
4. **Verified shapes section** added to rule 20 (models.list, listTools, toolInfo, mcp.initialize,
   create_sub_agent, ThreadCreatedEvent/AgentInfo, failure strings, snake_case wire, largeToolResponse default true).
5. **Rule 70:** `cannot connect` added to the unreachable regex.

## Exit check

- [x] `docs/progress/01-spike.md` has all 8 rows, with raw output
- [x] Rule 20 corrected wherever reality differed (list above); rule 70's regex fixed
- [x] `test/fixtures/minipkg` exists with the layout in rule 80 (own code; `pytest tests/test_cli.py` → 3 passed in the fixture venv at `.cache/minipkg-venv`)
- [x] `test/integration/global-setup.ts` and `harness.ts` exist; the harness MCP server is test-local (one `read_file`)
- [x] `test/integration/roundtrip.test.ts` and `test/integration/mcp.test.ts` pass under `npm run verify`
      (`✓ roundtrip 263ms · ✓ mcp 584ms`; the fake's request log is printed by mcp.test)
- [x] Commit: `forge: spike TrueForge round trip, approval, cancel, failure strings` (2e5c005) + this record

EXIT: passed (22:05)
