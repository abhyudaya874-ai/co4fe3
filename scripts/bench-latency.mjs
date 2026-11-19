#!/usr/bin/env node
// Live latency bench, THROUGH TRUEFORGE ONLY (law 1: never a direct provider call).
// For each model: N tiny text turns (time to first token, total, output tokens/s) and one tool-call probe through a
// throwaway MCP server. Prints a table and a recommended co4fe3.models.order; writes bench/latency.json (gitignored).
// Usage: npm run bench:latency [-- --runs 5 --models nvidia-nim/nemotron-super,google-gemini/gemini-flash-lite]
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { TrueForge, isEventDelta, mergeEventDelta } from "@truefoundry/trueforge-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const RUNS = Number(arg("runs", "5"));
const BASE = process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790";
const client = new TrueForge({ baseUrl: BASE, timeoutInSeconds: 30, maxRetries: 0 });
const STREAM = { timeoutInSeconds: 120, maxRetries: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pace = (fqn) => (fqn.startsWith("google-gemini/") ? 4500 : 1200);    // free tiers: Gemini allows ~15 requests/min per model
const pct = (xs, p) => { const a = xs.filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : null; };
const s = (ms) => (ms == null ? "   -  " : `${(ms / 1000).toFixed(2)} s`.padStart(7));

const cfgFile = existsSync("config/providers.json") ? "config/providers.json" : "config/providers.example.json";
const order = JSON.parse(readFileSync(cfgFile, "utf8")).order ?? [];
const fromArg = (arg("models") ?? "").split(",").filter(Boolean);
const models = fromArg.length ? fromArg : order;
if (!models.length) { console.error("No models: pass --models or set `order` in config/providers.json"); process.exit(2); }

// A throwaway MCP server with one read-only tool, so tool calling is measured the way co4fe3 uses it.
const token = randomBytes(18).toString("base64url");
const http = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) return void res.writeHead(401).end();
  if (req.method !== "POST") return void res.writeHead(405).end();
  const chunks = []; for await (const c of req) chunks.push(c);
  const server = new McpServer({ name: "co4fe3-bench", version: "0.0.1" });
  server.registerTool("ping", { description: "Returns pong followed by the text you send.", inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } },
    async ({ text }) => ({ content: [{ type: "text", text: `pong ${text}` }] }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, JSON.parse(Buffer.concat(chunks).toString() || "null"));
});
await new Promise((r) => http.listen(0, "127.0.0.1", r));
await client.settings.mcpServers.createOrUpdate({ manifest: { type: "remote", name: "co4fe3-bench", url: `http://127.0.0.1:${http.address().port}/mcp`, description: "co4fe3 latency bench ping tool", auth: { type: "header", headers: { Authorization: `Bearer ${token}` } } } });

const cfg = { askUserQuestions: { enabled: false }, generativeUi: { enabled: false }, dynamicSubAgents: { enabled: false }, sandbox: { enabled: false }, contextManagement: { compaction: { enabled: false }, largeToolResponse: { enabled: false } }, iterationLimit: 4 };

async function timedTurn(spec, text) {
  const t0 = performance.now();
  const { data: session } = await client.sessions.create({ agent: { spec } });
  const tReady = performance.now();
  const index = new Map();
  let tCreated = null, tFirst = null, status = "?", message = "", toolOk = false;
  const stream = await client.sessions.createTurnStream(session.id, { input: [{ type: "user.message", content: text }] }, STREAM);
  for await (const e of stream) {
    if (isEventDelta(e)) { const b = index.get(e.id); if (b) mergeEventDelta(b, e); tFirst ??= performance.now(); continue; }
    index.set(e.id, e);
    if (e.type === "turn.created") tCreated = performance.now();
    if (e.type === "tool.response" && JSON.stringify(e.content ?? "").includes("pong")) toolOk = true;
    if (e.type === "turn.done") { status = e.state.status; message = e.state.status === "error" ? e.state.message : ""; }
  }
  const tDone = performance.now();
  let outTokens = 0;
  for (const e of index.values()) if (e.type === "model.message") outTokens += e.usage?.outputTokens ?? 0;
  return { session: tReady - t0, created: tCreated && tCreated - tReady, ttft: tFirst && tFirst - tReady, total: tDone - tReady, outTokens, tokPerS: tFirst && outTokens ? outTokens / Math.max(0.001, (tDone - tFirst) / 1000) : null, toolOk, status, message };
}

const results = [];
for (const fqn of models) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    try { runs.push(await timedTurn({ model: { name: fqn, params: { temperature: 0, maxTokens: 64 } }, instructions: "Reply with one short sentence.", config: cfg }, `Say hello in five words. (${i})`)); }
    catch (e) { runs.push({ status: "error", message: e instanceof Error ? e.message : String(e) }); }
    await sleep(pace(fqn));
  }
  let probe;
  try { probe = await timedTurn({ model: { name: fqn, params: { temperature: 0, maxTokens: 128 } }, instructions: "Use the ping tool when asked.", mcpServers: [{ name: "co4fe3-bench", preload: true }], config: cfg }, "Call ping with text 'x', then reply with exactly what it returned."); }
  catch (e) { probe = { status: "error", toolOk: false, message: String(e) }; }
  await sleep(pace(fqn));
  const ok = runs.filter((r) => r.status === "done");
  results.push({ fqn, ok: ok.length, runs: RUNS, ttftP50: pct(ok.map((r) => r.ttft), 50), ttftP90: pct(ok.map((r) => r.ttft), 90), totalP50: pct(ok.map((r) => r.total), 50), tokPerS: pct(ok.map((r) => r.tokPerS), 50), tool: probe.toolOk ? "ok" : `no (${probe.status}${probe.message ? `: ${String(probe.message).slice(0, 60)}` : ""})`, errors: runs.filter((r) => r.status !== "done").map((r) => String(r.message).slice(0, 120)) });
  console.error(`benched ${fqn}`);
}
http.close();
await client.settings.mcpServers.delete("co4fe3-bench").catch(() => undefined);

console.log(`\n${"model".padEnd(42)} ok   ttft p50  ttft p90  total p50  tok/s  tool`);
for (const r of results) console.log(`${r.fqn.padEnd(42)} ${`${r.ok}/${r.runs}`.padEnd(4)} ${s(r.ttftP50)}   ${s(r.ttftP90)}   ${s(r.totalP50)}  ${String(r.tokPerS == null ? "-" : Math.round(r.tokPerS)).padStart(5)}  ${r.tool}`);

const healthy = results.filter((r) => r.ok >= RUNS - 1 && r.ttftP50 != null).sort((a, b) => a.ttftP50 - b.ttftP50);
const primary = healthy.find((r) => r.tool === "ok");
const provider = (f) => f.split("/")[0];
const fallback = primary && (healthy.find((r) => r !== primary && provider(r.fqn) !== provider(primary.fqn)) ?? healthy.find((r) => r !== primary));
const recommended = [primary?.fqn, fallback?.fqn].filter(Boolean);
console.log(`\nrecommended co4fe3.models.order: ${JSON.stringify(recommended)}  (primary = fastest p50 TTFT that passes the tool probe; fallback = fastest on another provider)`);

mkdirSync("bench", { recursive: true });
writeFileSync("bench/latency.json", JSON.stringify({ at: new Date().toISOString(), base: BASE, runs: RUNS, results, recommended }, null, 2));
