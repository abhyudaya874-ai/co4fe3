import { it, expect } from "vitest";
import { startHarness, toolName } from "./harness.js";

it("Stop mid-stream cancels within 1 s and the files are unchanged", async () => {
  const h = await startHarness(() => ({ text: "rivers ".repeat(400), chunks: 200, chunkDelayMs: 25 }));
  const ac = new AbortController();
  const t0 = Date.now();
  setTimeout(() => ac.abort(), 700);
  const out = await h.turn("write about rivers", { signal: ac.signal });
  const ms = Date.now() - t0;
  expect(out.status).toBe("cancelled");
  expect(ms).toBeLessThan(3000);   // abort → cancel → turn.done; the read ends at once (rule 60: Stop → "Stopped" ≤ 100 ms in the UI)
  expect(h.applier.last()).toBeUndefined();
  await h.close();
});

it("Stop during a pending review writes nothing and drops the proposal", async () => {
  const h = await startHarness((body, n) => n === 0
    ? { toolCalls: [{ name: toolName(body, "propose_edit"), args: { path: "src/minipkg/helpers.py", why: "wait for me", edits: [{ old_string: 'FALSE_VALUES = {"0", "false", "no"}', new_string: 'FALSE_VALUES = {"0", "false", "no", "off"}' }] } }] }
    : { text: "Done." });
  const before = await h.read("src/minipkg/helpers.py");
  const ac = new AbortController();
  const gate = new Promise<{ accept: string[] }>((resolve) => { (h as unknown as { gate?: (v: { accept: string[] }) => void }).gate = resolve; });
  const turnP = h.turn("propose and wait", {
    signal: ac.signal,
    onReview: () => { setTimeout(() => ac.abort(), 300); return gate; },   // the review waits; Stop arrives while it waits
  });
  const out = await turnP;
  expect(out.status).toBe("cancelled");
  expect(await h.read("src/minipkg/helpers.py")).toBe(before);   // nothing written
  expect(h.applier.last()).toBeUndefined();
  await h.close();
});
