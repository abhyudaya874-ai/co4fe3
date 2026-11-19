import { it, expect } from "vitest";
import { startHarness } from "./harness.js";

it("streams a text turn and ends with turn.done carrying the model's text", async () => {
  const h = await startHarness(() => ({ text: "hello from the fake model", chunks: 4, chunkDelayMs: 2 }));
  const out = await h.turn("Say hello.");
  expect(out.status).toBe("done");
  if (out.status === "done") expect(out.output).toContain("hello from the fake model");
  expect(h.fake.requests.length).toBeGreaterThanOrEqual(1);
  expect(h.fake.requests[0]?.path).toContain("/chat/completions");
  await h.close();
});
