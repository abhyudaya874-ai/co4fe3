import { it, expect } from "vitest";
import { TOOLS } from "../../packages/agent-core/src/runtime/modes.js";
import { startHarness, toolName } from "./harness.js";

it("TrueForge lists all 11 editor tools in TOOLS order, and a scripted read_file reaches our handler", async () => {
  const h = await startHarness((body, n) => n === 0
    ? { toolCalls: [{ name: toolName(body, "read_file"), args: { path: "src/minipkg/__init__.py" } }] }
    : { text: "Done." });
  const tools = await h.client.mcpServers.listTools(h.mcpName, { timeoutInSeconds: 15, maxRetries: 0 });
  const names = (tools as { data: { name: string }[] }).data.map((t) => t.name);
  expect(names).toEqual([...TOOLS]);   // read-first order, rule 60
  const out = await h.turn("Read src/minipkg/__init__.py.");
  expect(out.status).toBe("done");
  // The tool result reached the model: a later request's messages contain our file text.
  const withToolResult = h.fake.requests.find((r) => JSON.stringify(r.body?.messages ?? []).includes("__version__"));
  expect(withToolResult).toBeDefined();
  console.log("[mcp.test] fake request log:");
  for (const [i, r] of h.fake.requests.entries()) console.log(`  #${i} ${r.method} ${r.path} role=${r.body?.messages.at(-1)?.role}`);
  await h.close();
});
