// The context meter's input: real TrueForge streams the usage on the last model.message.delta, not on the model.message.
// This runs a streamed turn through real TrueForge + the fake model and asks `usageFromForge` what it finds.
import { it, expect } from "vitest";
import { startHarness } from "./harness.js";
import { usageFromForge } from "../../packages/agent-core/src/index.js";
import type { PanelEvent } from "../../packages/agent-core/src/panel/index.js";

it("a streamed turn reports the lead's token usage (it rides on a model.message.delta)", async () => {
  const h = await startHarness(() => ({ text: "hello from the fake model", chunks: 4, chunkDelayMs: 2 }));
  const found: Extract<PanelEvent, { kind: "usage" }>[] = [];
  const carriers = new Set<string>();
  const out = await h.turn("Say hello.", {
    onEvent: (e) => {
      const u = usageFromForge(e, { turnId: "t1", model: "fake/model", window: 8192 });
      if (u) { found.push(u); carriers.add(e.type); }
    },
  });
  expect(out.status).toBe("done");
  expect(found.length).toBeGreaterThanOrEqual(1);
  const last = found.at(-1)!;
  expect(last.inputTokens).toBeGreaterThan(0);
  expect(last.outputTokens).toBeGreaterThan(0);
  expect(last.window).toBe(8192);
  expect(Object.values(last.breakdown).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  expect([...carriers]).toEqual(["model.message.delta"]);               // if TrueForge ever moves it, this says where it went
  await h.close();
});
