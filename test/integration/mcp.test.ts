import { it, expect } from "vitest";
import { startHarness, toolName } from "./harness.js";

it("TrueForge lists our tools, the model's read_file reaches our handler, and the result reaches the model", async () => {
  const h = await startHarness((body, n) => n === 0
    ? { toolCalls: [{ name: toolName(body, "read_file"), args: { path: "src/minipkg/__init__.py" } }] }
    : { text: "Done." });
  const tools = await h.client.mcpServers.listTools(h.mcpName, { timeoutInSeconds: 15, maxRetries: 0 });
  const names = JSON.stringify(tools);
  expect(names).toContain("read_file");
  const out = await h.turn("Read src/minipkg/__init__.py.");
  expect(out.status).toBe("done");
  // The tool result reached the model: a later request's messages contain our file text.
  const withToolResult = h.fake.requests.find((r) => JSON.stringify(r.body?.messages ?? []).includes("__version__"));
  expect(withToolResult).toBeDefined();
  console.log("[mcp.test] fake request log:");
  for (const [i, r] of h.fake.requests.entries()) console.log(`  #${i} ${r.method} ${r.path} role=${r.body?.messages.at(-1)?.role}`);
  await h.close();
});
