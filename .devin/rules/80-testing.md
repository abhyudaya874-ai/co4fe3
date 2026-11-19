---
trigger: always_on
description: The test pyramid, the scripted fake OpenAI-compatible model server, the real-TrueForge integration harness, fixtures, the tests that must exist, and what verify runs
---

# Testing

**Fake the model, never the harness.** Integration tests run a real TrueForge (`npx`, pinned, temp SQLite), a real
MCP server and real files in a temp copy of a fixture repo. Only the model is fake: a tiny OpenAI-compatible server
that plays a script. That is how streaming, approvals, cancel, fallback and latency are proven for real, offline and
deterministically.

## The pyramid

| Layer | Where | Runs in | Speed | Proves |
|---|---|---|---|---|
| unit | `packages/agent-core/test/*.test.ts` | `verify:fast` | < 10 s total | every pure function: modes, turn policy, hunks, edits, verify, store, rrf, ranking, pack, symbol pack, budget, fallback, stats, hedge, reducer, evidence, instructions |
| hooks | `scripts/hooks/test-hooks.sh` | `verify:fast` | < 3 s | each guard blocks what it must and allows what it must (sample payloads) |
| turn | `packages/agent-core/test/turn.test.ts` | `verify:fast` | < 1 s | `runTurn` against a fake *SDK client object*: pause ordering, cancel, resume after a drop |
| perf | `packages/agent-core/test/perf/*.perf.test.ts` | `verify` | < 20 s | the latency budgets in rule 60, at 2× the budget |
| integration | `test/integration/*.test.ts` | `verify` | < 90 s | real TrueForge + fake model + real MCP + temp workspace |
| e2e | `extensions/co4fe3-vscode/test/*.test.ts` (`@vscode/test-cli`) | `verify` | < 60 s | activation time, the inline-edit command, diff tab, accept, undo |
| live | `scripts/bench-latency.mjs`, `scripts/smoke-live.mjs` | `verify:live` | minutes | real models through TrueForge; never in the default gate |

Rules:

- A bug gets a failing test **first**, then the fix, in one commit.
- Name tests by behaviour: `it("writes only the accepted hunk")`, not `it("works")`.
- Never snapshot model prose. Never `it.skip` or `it.todo` without a `docs/BACKLOG.md` line that names it.
- No network in unit or integration tests (`127.0.0.1` only). No real keys anywhere in `test/`.
- Fake timers for anything with a delay (`vi.useFakeTimers()`). Never assert on wall-clock time, except in perf
  tests, which assert 2× the budget.

## The fake model (`test/fakes/fake-openai.ts`). Copy it; SSE details are where small models go wrong.

```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type Step =
  | { text: string; chunks?: number; chunkDelayMs?: number }
  | { toolCalls: { name: string; args: unknown }[] }
  | { fail: number; message?: string }
  | { hang: true }
  | { delayMs: number; then: Step };
export type Script = Step[] | ((body: ChatBody, n: number) => Step);
export interface ChatBody { model: string; stream?: boolean; messages: { role: string; content?: unknown; tool_call_id?: string }[]; tools?: { type: string; function: { name: string; description?: string; parameters?: unknown } }[] }
export interface FakeModel { url: string; requests: { method: string; path: string; body: ChatBody | null }[]; close(): Promise<void> }

export async function startFakeOpenAI(script: Script): Promise<FakeModel> {
  const requests: FakeModel["requests"] = [];
  let n = 0;
  const server = createServer(async (req, res) => {
    const body = (await readJson(req)) as ChatBody | null;
    requests.push({ method: req.method ?? "", path: req.url ?? "", body });
    if (req.method === "GET" && req.url?.endsWith("/models")) return json(res, 200, { object: "list", data: [{ id: "scripted", object: "model" }] });
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions") || !body)
      return json(res, 404, { error: { message: `fake-openai does not serve ${req.method} ${req.url}` } }); // the spike reads this to learn what TrueForge calls
    const step = typeof script === "function" ? script(body, n++) : (script[n++] ?? { text: "Done." });
    await play(step, body, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

async function play(step: Step, body: ChatBody, res: ServerResponse): Promise<void> {
  if ("delayMs" in step) { await sleep(step.delayMs); return play(step.then, body, res); }
  if ("hang" in step) return;                                                   // never answers: tests the stall timer
  if ("fail" in step) return json(res, step.fail, { error: { message: step.message ?? `fake http ${step.fail}`, type: "fake", code: step.fail } });
  const id = `chatcmpl-${Math.random().toString(36).slice(2, 10)}`, created = Math.floor(Date.now() / 1000);
  const calls = "toolCalls" in step ? step.toolCalls.map((c, i) => ({ index: i, id: `call_${id}_${i}`, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) : [];
  const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
  if (!body.stream) {
    const message = "text" in step ? { role: "assistant", content: step.text } : { role: "assistant", content: null, tool_calls: calls.map(({ index: _i, ...c }) => c) };
    return json(res, 200, { id, object: "chat.completion", created, model: body.model, choices: [{ index: 0, message, finish_reason: calls.length ? "tool_calls" : "stop" }], usage });
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (o: object) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const chunk = (delta: object, finish: string | null = null) => ({ id, object: "chat.completion.chunk", created, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] });
  send(chunk({ role: "assistant", content: "" }));
  if ("text" in step) {
    for (const part of splitInto(step.text, step.chunks ?? 8)) { send(chunk({ content: part })); if (step.chunkDelayMs) await sleep(step.chunkDelayMs); }
    send(chunk({}, "stop"));
  } else {
    for (const c of calls) send(chunk({ tool_calls: [c] }));
    send(chunk({}, "tool_calls"));
  }
  send({ id, object: "chat.completion.chunk", created, model: body.model, choices: [], usage });
  res.end("data: [DONE]\n\n");
}

/** TrueForge may expose MCP tools under a prefixed name. Find the real one in the request. */
export function toolName(body: ChatBody, bare: string): string {
  const hit = body.tools?.map((t) => t.function.name).find((n) => n === bare || n.endsWith(`__${bare}`) || n.endsWith(`.${bare}`) || n.endsWith(`_${bare}`));
  if (!hit) throw new Error(`model request has no tool like ${bare}; it has: ${body.tools?.map((t) => t.function.name).join(", ")}`);
  return hit;
}
export const lastRole = (b: ChatBody): string => b.messages.at(-1)?.role ?? "";
```

(`readJson`, `json`, `sleep` and `splitInto` are 10 lines in the same file. `splitInto` must cut on character
boundaries, never in the middle of a surrogate pair.)

A script is usually a function of the request, so it survives TrueForge adding messages:

```ts
const taskA: Script = (body) => lastRole(body) === "user"
  ? { text: "```python\ndef get_verbose_flag() -> bool:\n    ...\n```", chunks: 12, chunkDelayMs: 5 }
  : { text: "Done." };
```

## The integration harness (`test/integration/harness.ts`)

- `globalSetup` starts one TrueForge for the whole integration project:
  `npx --yes @truefoundry/trueforge@<PINNED> --port <free>`, with `SQLITE_PATH=<tmp>/tf.sqlite`. It waits for
  `health()` (60 s cap, polling every 250 ms) and exports `TRUEFORGE_TEST_URL`.
- Each test calls `startHarness(script)`, which does five things:
  1. starts its own fake model;
  2. registers it as a `custom` provider with a unique name (`fake-<n>`);
  3. copies `test/fixtures/minipkg` to a temp dir;
  4. starts the MCP server over a `NodeTestHost` (an EditorHost over the temp dir) and a `TestApplier` (writes the
     temp dir; it lives in `test/` only);
  5. registers that MCP server under a unique name.
- `close()` deletes the provider and MCP server registrations, stops the fake and removes the temp dir.

```ts
export interface Harness {
  fake: FakeModel; client: TrueForge; model: string /* "fake-<n>/scripted" */; mcpName: string; root: string;
  applier: Applier & { last(): Checkpoint | undefined };
  read(rel: string): Promise<string>;
  /** One turn through runTurn with the coder spec. `onReview` decides every proposal (default: accept all). */
  turn(text: string, o?: { onReview?: (p: Proposal) => { accept: string[] }; signal?: AbortSignal }): Promise<TurnOutcome>;
  close(): Promise<void>;
}
```

```ts
it("writes only the accepted hunk, and Undo restores the exact bytes", async () => {
  const h = await startHarness((body, n) => n === 0
    ? { toolCalls: [{ name: toolName(body, "propose_edit"), args: { path: "src/minipkg/helpers.py", why: "accept off and n", edits: [EDIT_ONE, EDIT_TWO] } }] }
    : { text: "Done." });
  const before = await h.read("src/minipkg/helpers.py");
  const out = await h.turn("treat off and n as false", { onReview: (p) => ({ accept: [p.hunks[0]!.id] }) });   // reviewer accepts h1 only
  expect(out.status).toBe("done");
  expect(await h.read("src/minipkg/helpers.py")).toBe(applyHunks(before, toHunks(before, planOk(before, [EDIT_ONE, EDIT_TWO])), new Set(["h1"])));
  await h.applier.undo(h.applier.last()!.id);
  expect(await h.read("src/minipkg/helpers.py")).toBe(before);
  await h.close();
});
```

## Tests that must exist before the matching workflow is done

| Workflow | Tests |
|---|---|
| 01 spike | `integration/roundtrip`: text streams, then `turn.done`. `integration/mcp`: TrueForge lists our tools, the model's `read_file` reaches our handler, and `tool.response` holds our output. The fake's request log is printed. |
| 02 MCP | `modes` (rule 50 §1), `policy` (`TurnPolicy`: reminder at the 3rd identical call, refusal at the 5th, safety stop after 4 failures, success resets), `truncate`, `mcp-tools` (each tool through the MCP client SDK over HTTP: auth rejected without a token, a non-loopback Host rejected, jail, caps, `wrap()` bound, read-first registration order) |
| 03 review core | `hunks` (property), `edits` (one test per `EditReject`, several bad ops in one result), `store`, `checkpoints` (undo exactness), `verify` (moved errors are not new, duplicates count, warnings ignored), `jail` |
| 04 inline | `inline` (partial and final fenced block, phase transitions incl. `sourceChanged`), e2e `inline.test` (diff tab opens, accept writes, undo restores) |
| 05 panel | `reducer` (replaying the same events twice gives the same state; brief/report messages; member rows merge; approvals), `coalesce`, `pause` (one review per file; later calls on that file denied with the sentence), `integration/cancel` (Stop during a stream → cancelled within 1 s, files unchanged; Stop during a pending review → nothing written; members marked `cancelled` first) |
| 06 context | `tokens`, `symbols`, `rrf` (1st+50th beats a single 1st, empty channel, duplicates, ties), `repomap` (on minipkg, the Task-B-like query ranks `cli.py`, `tests/test_cli.py` and `docs/cli.rst` in the top 5; a missing grep channel still ranks), `budget` (`withinBudget` full/quick/none with a fake timer), `pack` (budget property), `symbolPack` (caps per task, trim order, fits `max_tokens`), `mentions` |
| 07 crew | `evidence` (`assessMemberOutcome`: claimed edits without accepted hunks → blocked; research never blocked; failed → failed), `crewpolicy` (`commandPolicy` table, `crewWatch` hard stop at 8), `integration/crew` (scripted `create_sub_agent` → brief and report bubbles; a research member's `propose_edit` is denied with the reason) |
| 08 fallback | `fallback` (classify table from the spike's real strings; runWithFallback: 401 → next, 500 → retry once then next, stall → next, side effect → no retry, all fail), `attempt` (first-token and idle watchdogs, no stall during a long review), `integration/fallback` (provider A answers 401, provider B answers, files unchanged) |
| 09 latency | `stats`, `hedge` (fake timer), `marks`, `perf/*` (incl. `rankFiles` with 4 channels, `shapeSymbolPack`), `integration/overhead` |
| 10 instructions | `frontmatter` (nested `triggers:`, block scalars), `instructions` (file order and caps, `.v3code/skills`, `activeSkills`, budget overflow → on demand) |

## Test style, after V3Code

V3Code keeps every policy in a pure `common/` module because "there is no DI test harness for the thread service".
Its tests are plain `suite`/`test` with Node `assert`, and no services are faked (`test/common/localAgentRuntime.test.ts`).
We follow the same rule with vitest:

- If a decision cannot be unit-tested without the editor or the network, it is in the wrong layer. Move it into
  agent-core and pass the I/O in.
- A test names the behaviour and the rule it pins: `it("refuses the 5th identical call (rule 50 §2)")`.
- The e2e tests under `@vscode/test-cli` use mocha's TDD `suite`/`test`, exactly like V3Code's.

## `npm run verify` (`scripts/verify.mjs`)

```js
const fast = process.argv.includes("--fast"), live = process.argv.includes("--live");
const stages = [
  ["invariants", "node scripts/check-invariants.mjs"],
  ["hooks", "bash scripts/hooks/test-hooks.sh"],          // the guards themselves are tested (needs jq)
  ["typecheck", "npm run typecheck"],
  ["unit", "npx vitest run --project unit"],
  ...(fast ? [] : [["perf", "npx vitest run --project perf"], ["integration", "npx vitest run --project integration"], ["build", "npm run build -w extensions/co4fe3-vscode"], ["e2e", "npx vscode-test"]]),
  ...(live ? [["bench", "node scripts/bench-latency.mjs"], ["smoke", "node scripts/smoke-live.mjs"]] : []),
];
for (const [name, cmd] of stages) {
  const t = Date.now();
  const r = spawnSync(cmd, { shell: true, stdio: "inherit" });
  console.log(`[verify] ${name} ${r.status === 0 ? "ok" : "FAILED"} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!fast) { mkdirSync(".devin", { recursive: true }); writeFileSync(".devin/.last-verify", new Date().toISOString() + "\n"); }
console.log(`\nverify${fast ? " (fast)" : live ? " (live)" : ""}: all stages passed`);
```

`.vscode-test.mjs` (root):

```js
import { defineConfig } from "@vscode/test-cli";
export default defineConfig({ files: "extensions/co4fe3-vscode/out/test/**/*.test.js", workspaceFolder: "test/fixtures/minipkg", mocha: { timeout: 60_000 } });
```

## The fixture (`test/fixtures/minipkg`): our own code that mimics flask's shape

```
src/minipkg/__init__.py
src/minipkg/helpers.py    get_verbose_flag(): env MINIPKG_VERBOSE, false for {"0","false","no"}   (Task A shape)
src/minipkg/cli.py        click group with built-in commands `routes` and `shell`, registered in Group.__init__ (Task B shape)
tests/test_cli.py         CliRunner tests for the built-ins
docs/cli.rst              a "Built-in commands" section
pyproject.toml            name = "minipkg"
```

Do not copy flask code into the repo (BSD-3 needs attribution, and the fixture must stay ours). Rehearsals run on a
real flask clone in `.cache/flask` (workflow 11).
