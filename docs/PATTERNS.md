# PATTERNS

Copy the recipe and adapt it. Do not design a new shape for an old problem. Each recipe names the files it touches
and the check that proves it.

## P1 A pure core function, test first

Files: `packages/agent-core/src/<area>/<name>.ts` and `packages/agent-core/test/<name>.test.ts`.

```ts
// test first
import { describe, expect, it } from "vitest";
import { fc, it as prop } from "@fast-check/vitest";
import { applyHunks, toHunks } from "../src/review/hunks";

describe("applyHunks", () => {
  it("applies only the hunks it is given", () => {
    const a = "a\nb\nc\n", b = "A\nb\nC\n";
    const hs = toHunks(a, b);
    expect(applyHunks(a, hs, new Set([hs[0]!.id]))).toBe("A\nb\nc\n");
  });
  prop.prop([fc.string(), fc.string()])("all → after, none → before", (a, b) => {
    const hs = toHunks(a, b);
    expect(applyHunks(a, hs, new Set(hs.map((h) => h.id)))).toBe(b);
    expect(applyHunks(a, hs, new Set())).toBe(a);
  });
});
```

Rules: no clock (inject `now`), no randomness (inject `rand`), no I/O, inputs never mutated, an exhaustive `switch`
over unions with `assertNever`. Check: `npx vitest run packages/agent-core/test/<name>.test.ts`.

## P2 A TrueForge call

All of them live in `agent-core/src/forge/*`. UI code calls those functions, never the SDK.

```ts
const { data: session } = await client.sessions.create({ agent: { spec } }, ONCE);        // state-changing → ONCE (0 retries)
const stream = await client.sessions.createTurnStream(id, body, { ...STREAM, abortSignal }); // streams → STREAM (600 s, 0 retries)
```

Look the method up in rule 20 or the `.d.ts` first. Check: an integration test against the real local TrueForge.

## P3 Run a turn and show it

```ts
const out = await runTurn({ client, sessionId, text, signal: ac.signal, hooks: {
  onEvent: (e, index) => { for (const pe of fromForge(e, index)) bridge.push(pe); },
  onPause: makeOnPause(pauseDeps),
} });
bridge.push({ kind: "status", state: out.status === "done" ? "done" : out.status, message: out.status === "error" ? out.message : undefined });
bridge.flush();
```

## P4 Add an MCP tool

Files: `mcp/server.ts`, `docs/CODEMAP.md`. Also rule 50's role sets, and `check-invariants.mjs`'s known-tool list
(the human approves that edit).

```ts
s.registerTool("find_symbol", {
  title: "Find a symbol",
  description: "Find where a function, class or command is defined, and how many files use it. Exact name, case-sensitive.",   // one job, what it returns, the limits
  inputSchema: { name: z.string().min(1).max(120) },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, wrap("find_symbol", async ({ name }) => {
  const ix = d.index();
  if (!ix) throw new ToolInputError("The index is still building. Use search_workspace for now.");
  const defs = (ix.defs.get(name) ?? []).slice(0, 20);
  if (!defs.length) throw new ToolInputError(`No definition named ${name}. Try search_workspace with part of the name.`);
  return text(defs.map((p) => `${p.path}:${p.line} ${p.sig}`).join("\n") + `\nused in ${ix.users.get(name)?.size ?? 0} files`);
}));
```

Every tool:
- goes through `wrap()` (repeat guard, timing, readable errors);
- passes paths through `jail()`;
- caps its output from `BUDGET`;
- has an error that tells the model what to do next;
- uses `annotations` that are honest.

A tool that changes anything is gated by literal name in `agents/co4fe3-coder.agent.json` and handled in
`pause.ts` (P5). Check: `mcp-tools.test.ts` drives the tool through the MCP client over HTTP.

## P5 Answer a new kind of pause

Add a branch in `panel/pause.ts` `makeOnPause`. Every branch returns exactly one answer per pending call, through
`allow`, `deny(p, reason)` or `reply(p, content)`. The reason is a sentence the model can act on. Anything that
causes a write calls `d.sideEffect()` before `allow`.

## P6 Write to the workspace

There is one way:

```ts
const r = await applyDecision(applier, proposal, decision);            // review/apply.ts → Applier.apply → checkpoint
if (!r.ok) bridge.push({ kind: "marker", id: `conflict-${proposal.key}`, text: r.detail });
```

Never `workspace.applyEdit`, `workspace.fs.writeFile` or `doc.save()` anywhere else. The hooks and the checker block it.

## P7 A VS Code command

1. Add it to `contributes.commands` (and keybindings/menus if needed) in the extension's `package.json`.
2. Register it in `extension.ts`: `ctx.subscriptions.push(vscode.commands.registerCommand("co4fe3.x", handler))`.
3. Put the handler in its feature folder.
4. Add the id to CODEMAP.

Check: the command palette shows it in the Extension Development Host.

## P8 A setting

Add it to `contributes.configuration.properties` (type, default, bounds, description), then to `Config` and
`readConfig()` in `config.ts`, then to the CODEMAP settings line. Read it through `readConfig()` at use time, so
changes apply without a reload.

## P9 Add a field to a PanelEvent

1. Add the optional field to the union member in `panel/events.ts`.
2. Set it where the event is produced (`forge/fromForge.ts` or the extension producer).
3. Add a reducer test that the field survives a replace (or a merge, for `member`).
4. Render it in the component.

Optional fields keep old batches valid.

## P10 A webview component

```tsx
export const ToolCard = memo(function ToolCard({ e }: { e: Extract<PanelEvent, { kind: "tool" }> }) {
  return (
    <div className={`card tool ${e.state}`}>
      <div className="card-head"><span className="codicon codicon-tools" /> {e.name} <span className="muted">{e.ms != null ? `${e.ms} ms` : "…"}</span></div>
      <pre className="args">{shorten(e.args, 300)}</pre>
      {e.result !== undefined && <details><summary>result</summary><pre>{shorten(e.result, 4000)}</pre></details>}
    </div>
  );
});
```

Rules:
- Colours come only from VS Code theme variables (in `panel.css`).
- Model text goes through `md.tsx` or `<pre>`, never HTML.
- No component state except ephemeral input. Everything else is in `PanelState`.

## P11 A failure the user sees

Every failure gets one sentence that names what failed, why, and what happens next (see `failureLine`). Show it
where it happened (a banner row, toast or status). Send the redacted raw error to the output channel:
`out.error(redact(String(e)))`. Never show a stack trace in the UI.

## P12 A latency budget

```ts
const m = new Marks(); m.mark("enter");  …  m.mark("firstDelta");  …  m.mark("done");
out.info(m.line(model));                                  // "perf ttft=1234 created=210 total=5400 model=…"
```

For pure code, add a perf test that asserts 2× the rule 60 budget and prints the median.

## P13 An integration test with the fake model

```ts
const h = await startHarness((body, n) => n === 0
  ? { toolCalls: [{ name: toolName(body, "read_file"), args: { path: "src/minipkg/cli.py" } }] }
  : { text: "Done." });
const out = await h.turn("what does cli.py register?");
expect(out.status).toBe("done");
expect(h.fake.requests.at(-1)?.body?.messages.some((m) => m.role === "tool")).toBe(true);   // the tool result reached the model
await h.close();
```

Scripts are functions of the request (rule 80), so they survive TrueForge adding system messages.
