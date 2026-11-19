// scripts/spike.mjs — node scripts/spike.mjs <section>   (sections: text | tool | gate | cancel | fail | fake)
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { TrueForge, isEventDelta, mergeEventDelta } from "@truefoundry/trueforge-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const BASE = process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790";
const MODEL = process.env.SPIKE_MODEL ?? "google-gemini/gemini-flash-lite";
const client = new TrueForge({ baseUrl: BASE, timeoutInSeconds: 30, maxRetries: 0 });
const STREAM = { timeoutInSeconds: 600, maxRetries: 0 };
const t0 = Date.now(), ms = () => `${String(Date.now() - t0).padStart(6)}ms`;

async function startPingServer() {
  const token = randomBytes(18).toString("base64url");
  const http = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) return void res.writeHead(401).end();
    if (req.method !== "POST") return void res.writeHead(405).end();
    const chunks = []; for await (const c of req) chunks.push(c);
    const server = new McpServer({ name: "spike", version: "0.0.1" });
    server.registerTool("ping", { description: "Returns pong and the text you send.", inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } },
      async ({ text }) => { console.log(ms(), "MCP ping called with", text); return { content: [{ type: "text", text: `pong: ${text}` }] }; });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, JSON.parse(Buffer.concat(chunks).toString() || "null"));
  });
  await new Promise((r) => http.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${http.address().port}/mcp`;
  await client.settings.mcpServers.createOrUpdate({ manifest: { type: "remote", name: "co4fe3-spike", url, description: "spike ping server", auth: { type: "header", headers: { Authorization: `Bearer ${token}` } } } });
  console.log(ms(), "tools seen by TrueForge:", JSON.stringify(await client.mcpServers.listTools("co4fe3-spike")));
  return http;
}

async function turn(spec, text, { onPause, cancelAfterDeltas } = {}) {
  const { data: session } = await client.sessions.create({ agent: { spec } });
  console.log(ms(), "session", session.id);
  const index = new Map(); let turnId, last, deltas = 0;
  let stream = await client.sessions.createTurnStream(session.id, { input: [{ type: "user.message", content: text }] }, STREAM);
  for (;;) {
    const pending = []; let paused = false;
    for await (const e of stream) {
      last = e.id;
      if (isEventDelta(e)) { mergeEventDelta(index.get(e.id), e); if (++deltas === 1) console.log(ms(), "first delta"); if (deltas === cancelAfterDeltas) { console.log(ms(), "cancel()"); void client.sessions.cancel(session.id); } continue; }
      index.set(e.id, e);
      console.log(ms(), e.type, e.threadId ?? "", JSON.stringify(e).slice(0, 300));
      if (e.type === "turn.created") turnId = e.turnId;
      if (e.type === "tool.approval_required") pending.push(e);
      if (e.type === "turn.update" && e.state.status === "paused") { paused = true; break; }
      if (e.type === "turn.done") return { session, e };
    }
    if (!paused) throw new Error("stream ended without turn.done");
    const answers = await onPause(pending, index);
    const resume = await client.sessions.subscribeToTurn(session.id, turnId, { afterEventId: last }, STREAM);
    await client.sessions.createTurnEvents(session.id, turnId, { events: answers });
    stream = resume;
  }
}

const base = { model: { name: MODEL, params: { temperature: 0, maxTokens: 512 } }, config: { askUserQuestions: { enabled: false }, generativeUi: { enabled: false }, dynamicSubAgents: { enabled: false }, iterationLimit: 8 } };
const section = process.argv[2];
if (section === "text") await turn({ ...base, instructions: "Be brief." }, "Say hello in five words.");
if (section === "tool" || section === "gate") {
  const http = await startPingServer();
  const gate = section === "gate" ? { requireApprovalForTools: ["ping"] } : {};
  await turn({ ...base, instructions: "Use the ping tool when asked.", mcpServers: [{ name: "co4fe3-spike", preload: true, ...gate }] }, "Call ping with text 'hi', then tell me what it returned.",
    { onPause: async (pending, index) => pending.flatMap((p) => p.toolCalls.map((ref) => {
        const call = index.get(ref.sourceEventId)?.toolCalls?.find((c) => c.id === ref.id);
        console.log(ms(), "APPROVAL for", JSON.stringify(call?.toolInfo), call?.function?.arguments);
        return { type: "user.tool_approval", threadId: p.threadId, toolCallId: ref.id, approval: { status: "allow" } };
      })) });
  http.close();
}
if (section === "cancel") await turn({ ...base, instructions: "Write long answers." }, "Write 400 words about rivers.", { cancelAfterDeltas: 3 });
if (section === "fail") {   // bad key, then unreachable URL: record turn.done.state.message and the time it took
  for (const [name, baseUrl, apiKey] of [["spike-badkey", "https://integrate.api.nvidia.com/v1", "nvapi-invalid"], ["spike-down", "http://127.0.0.1:9/v1", "x"]]) {
    await client.settings.modelProviders.createOrUpdate({ manifest: { type: "custom", name, baseUrl, auth: { apiKey }, models: [{ name: "m", modelId: "nvidia/nemotron-3.5-super-vl-120b-a12b", properties: {} }] } });
    const { e } = await turn({ ...base, model: { name: `${name}/m` } }, "hi");
    console.log(ms(), "FAILURE STRING:", JSON.stringify(e.state));
  }
}
if (section === "subagents") {   // row 7: the real model, dynamicSubAgents on; thread.created / thread.done shapes
  const { e } = await turn({ ...base, config: { ...base.config, dynamicSubAgents: { enabled: true } }, instructions: "You may create subagents with create_sub_agent. They must answer in one short line." }, "Use two subagents in parallel: one says a colour, one says a number.");
  console.log(ms(), "final:", JSON.stringify(e.state).slice(0, 400));
}
if (section === "fake") {
  const { startFakeOpenAI } = await import("../test/fakes/fake-openai.ts");
  const fake = await startFakeOpenAI(() => ({ text: "ok" }));
  await client.settings.modelProviders.createOrUpdate({ manifest: { type: "custom", name: "spike-fake", baseUrl: fake.url, auth: { apiKey: "fake" }, models: [{ name: "scripted", modelId: "scripted", properties: {} }] } });
  const spec = { ...base, model: { name: "spike-fake/scripted" }, config: { ...base.config, dynamicSubAgents: { enabled: true } }, instructions: "You may create subagents with create_sub_agent." };
  const { e } = await turn(spec, "Use two subagents in parallel: one says a colour, one says a number.");
  console.log(ms(), "final:", JSON.stringify(e.state).slice(0, 400));
  for (const r of fake.requests) {
    console.log("REQ", r.method, r.path, "keys:", r.body ? Object.keys(r.body).join(",") : "null");
    if (r.body?.tools) console.log("  tools:", r.body.tools.map((t) => t.function.name).join(", "));
  }
  await fake.close();
}
