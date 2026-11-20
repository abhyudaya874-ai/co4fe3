// Workflow 08: attemptTurn + runWithFallback against real TrueForge — 401 falls back to the next
// provider; a hang falls back after the stall timer. Notes land in order; nothing is written.
import { it, expect } from "vitest";
import { inject } from "vitest";
import { TrueForge } from "@truefoundry/trueforge-sdk";
import { startFakeOpenAI } from "../fakes/fake-openai.js";
import { startHarness } from "./harness.js";
import { attemptTurn, runWithFallback, realSleep, type Note, type AttemptResult } from "../../packages/agent-core/src/index.js";

const ONCE = { timeoutInSeconds: 15, maxRetries: 0 } as const;
const spec = (model: string) => ({
  model: { name: model, params: { temperature: 0, maxTokens: 128 } },
  instructions: "Reply briefly.",
  mcpServers: [],
  config: { askUserQuestions: { enabled: false }, generativeUi: { enabled: false }, dynamicSubAgents: { enabled: false }, iterationLimit: 4 },
});

async function secondProvider(client: TrueForge, n: number): Promise<{ fqn: string; close(): Promise<void> }> {
  const fake = await startFakeOpenAI(() => ({ text: "answer from the fallback model" }));
  const name = `fakeb-${n}`;
  await client.settings.modelProviders.createOrUpdate({
    manifest: { type: "custom", name, baseUrl: fake.url, auth: { apiKey: "fake" }, models: [{ name: "scripted", modelId: "scripted", properties: {} }] },
  }, ONCE);
  return { fqn: `${name}/scripted`, close: async () => { await client.settings.modelProviders.delete(name).catch(() => undefined); await fake.close(); } };
}

async function run(h: Awaited<ReturnType<typeof startHarness>>, order: string[], stallMs: number): Promise<{ model: string | null; notes: Note[]; kinds: string[] }> {
  const notes: Note[] = [];
  const r = await runWithFallback(order, async (model, _n, s): Promise<AttemptResult> => {
    const { data: session } = await h.client.sessions.create({ agent: { spec: spec(model) } }, ONCE);
    return await attemptTurn({ client: h.client, sessionId: session.id, text: "say hi", previousTurnId: "none", stallMs, model }, { onText: () => undefined, onStatus: () => undefined }, s);
  }, (n) => notes.push(n), new AbortController().signal, realSleep);
  return { model: r.model, notes, kinds: notes.map((n) => n.kind) };
}

it("a 401 on the primary falls back to the fallback provider with no user action", async () => {
  const h = await startHarness(() => ({ fail: 401, message: "invalid api key for this provider" }));
  const b = await secondProvider(h.client, 1);
  try {
    const order = [`${h.model}`, b.fqn];
    const r = await run(h, order, 15_000);
    expect(r.model).toBe(b.fqn);
    expect(r.kinds).toEqual(["attempt", "failed", "attempt", "answered"]);
    const failed = r.notes[1]!;
    expect(failed.kind === "failed" && failed.failure.kind).toBe("auth");
    const answered = r.notes[3]!;
    expect(answered.kind === "answered" && answered.fellBack).toBe(true);
    expect(h.applier.last()).toBeUndefined();          // nothing was written
  } finally { await b.close(); await h.close(); }
}, 60_000);

it("a hang on the primary stalls at stallMs and falls back", async () => {
  const h = await startHarness(() => ({ hang: true }));
  const b = await secondProvider(h.client, 2);
  try {
    const t0 = Date.now();
    const r = await run(h, [h.model, b.fqn], 1500);
    expect(r.model).toBe(b.fqn);
    expect(r.kinds).toEqual(["attempt", "failed", "attempt", "answered"]);
    const failed = r.notes[1]!;
    expect(failed.kind === "failed" && failed.failure.kind).toBe("stall");
    expect(Date.now() - t0).toBeLessThan(15_000);     // it really was the timer, not a network timeout
  } finally { await b.close(); await h.close(); }
}, 60_000);
