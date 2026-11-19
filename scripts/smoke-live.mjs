#!/usr/bin/env node
// One real turn on the primary model, through TrueForge. Fails (exit 1) if it does not finish. Used by verify:live.
import { readFileSync, existsSync } from "node:fs";
import { TrueForge, isEventDelta } from "@truefoundry/trueforge-sdk";

const client = new TrueForge({ baseUrl: process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790", timeoutInSeconds: 30, maxRetries: 0 });
const cfgFile = existsSync("config/providers.json") ? "config/providers.json" : "config/providers.example.json";
const model = process.env.SMOKE_MODEL ?? JSON.parse(readFileSync(cfgFile, "utf8")).order?.[0];
if (!model) { console.error("no model: set SMOKE_MODEL or `order` in config/providers.json"); process.exit(2); }

const t0 = performance.now();
const { data: session } = await client.sessions.create({ agent: { spec: { model: { name: model, params: { temperature: 0, maxTokens: 32 } }, instructions: "Reply in five words.", config: { askUserQuestions: { enabled: false }, generativeUi: { enabled: false }, dynamicSubAgents: { enabled: false } } } } });
let first = null, state = null;
for await (const e of await client.sessions.createTurnStream(session.id, { input: [{ type: "user.message", content: "Say hello." }] }, { timeoutInSeconds: 120, maxRetries: 0 })) {
  if (isEventDelta(e)) first ??= performance.now();
  if (e.type === "turn.done") state = e.state;
}
const ms = (x) => (x == null ? "-" : `${Math.round(x - t0)} ms`);
console.log(`smoke ${model}: status=${state?.status} ttft=${ms(first)} total=${ms(performance.now())}${state?.status === "error" ? ` error=${state.message}` : ""}`);
process.exit(state?.status === "done" ? 0 : 1);
