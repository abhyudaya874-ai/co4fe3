// Workflow 09, rule 60's two overhead rows: a real TrueForge + a zero-latency fake model measure exactly
// what co4fe3 adds (TrueForge hop, MCP, review, rendering). Task-A-shaped < 1.2 s; Task-B-shaped < 4 s.
import { it, expect } from "vitest";
import { startHarness } from "./harness.js";
import { attemptTurn, Marks } from "../../packages/agent-core/src/index.js";

const ONCE = { timeoutInSeconds: 15, maxRetries: 0 } as const;

it("Task-A-shaped turn costs < 1.2 s of our own time", async () => {
  const h = await startHarness(() => ({ text: "```python\nx = 1\n```", chunks: 4 }));
  try {
    const m = new Marks();
    m.mark("enter");
    const { data: s } = await h.client.sessions.create({ agent: { spec: {
      model: { name: h.model, params: { temperature: 0, maxTokens: 2048 } },
      instructions: "Reply with one fenced block.", mcpServers: [],
      config: { askUserQuestions: { enabled: false }, generativeUi: { enabled: false }, dynamicSubAgents: { enabled: false }, iterationLimit: 4 },
    } } }, ONCE);
    m.mark("session");
    const r = await attemptTurn({ client: h.client, sessionId: s.id, text: "edit", previousTurnId: "none", stallMs: 5000, model: h.model }, { onText: () => m.mark("firstDelta"), onStatus: () => undefined }, new AbortController().signal);
    m.mark("done");
    console.log(m.line(h.model), `session=${m.span("enter", "session")}ms`);
    expect(r.outcome.status).toBe("done");
    expect(m.span("enter", "done")).toBeLessThan(1200);
  } finally { await h.close(); }
}, 60_000);

it("Task-B-shaped turn (10 reads, 2 accepted proposals, 1 run_command) costs < 4 s", async () => {
  let n = 0;
  const h = await startHarness(() => {
    n++;
    if (n === 1) return { toolCalls: Array.from({ length: 10 }, () => ({ name: "read_file", args: { path: "helpers.py" } })) };
    if (n === 2) return { toolCalls: [
      { name: "propose_edit", args: { path: "helpers.py", why: "tweak", edits: [{ old_string: "MINIPKG_VERBOSE", new_string: "MINIPKG_VERBOSE /* changed */" }] } },
      { name: "propose_edit", args: { path: "helpers.py", why: "tweak2", edits: [{ old_string: "get_debug_flag", new_string: "get_debug_flag_v2" }] } },
    ] };
    if (n === 3) return { toolCalls: [{ name: "run_command", args: { command: "node -e \"process.exit(0)\"" } }] };
    return { text: "Done." };
  });
  try {
    const m = new Marks();
    m.mark("enter");
    const r = await h.turn("do the task");              // the harness drives the real pause/review flow
    m.mark("done");
    console.log(`perf overhead task-B-shape total=${m.span("enter", "done")}ms model=${h.model}`);
    expect(r.status).toBe("done");
    expect(m.span("enter", "done")).toBeLessThan(4000);
  } finally { await h.close(); }
}, 60_000);
