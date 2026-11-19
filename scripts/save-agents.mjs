#!/usr/bin/env node
// Saves agents/co4fe3-coder.agent.json and agents/co4fe3-inline.agent.json as named agents in TrueForge, so they show
// in its UI (Agents page). The extension itself always uses inline-spec sessions built from the same files (rule 20, trap 6).
// Run while VS Code with co4fe3 is open: it needs the editor MCP server the extension registered (co4fe3-ws-<hash>).
import { readFileSync, existsSync } from "node:fs";
import { TrueForge } from "@truefoundry/trueforge-sdk";

const client = new TrueForge({ baseUrl: process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790", timeoutInSeconds: 20, maxRetries: 0 });
const servers = await client.settings.mcpServers.list();                    // VERIFY the response shape on first run
const editor = JSON.stringify(servers).match(/co4fe3-ws-[0-9a-f]{8}/)?.[0];
if (!editor) { console.error("No co4fe3-ws-<hash> MCP server in TrueForge. Open a workspace in VS Code with co4fe3 running, then retry."); process.exit(2); }

const cfgFile = existsSync("config/providers.json") ? "config/providers.json" : "config/providers.example.json";
const model = JSON.parse(readFileSync(cfgFile, "utf8")).order?.[0];
if (!model) { console.error("Set `order` in config/providers.json first."); process.exit(2); }

const agents = [
  ["co4fe3-coder", "agents/co4fe3-coder.agent.json", "co4fe3 agent mode: lead + crew, editor tools over MCP, per-hunk review"],
  ["co4fe3-inline", "agents/co4fe3-inline.agent.json", "co4fe3 inline edit: one streamed replacement, no tools"],
];
for (const [name, file, description] of agents) {
  const manifest = JSON.parse(readFileSync(file, "utf8").replaceAll("$MODEL", model).replaceAll("$EDITOR", editor));
  const found = [];
  for await (const a of await client.agents.list({ agentName: name })) found.push(a);   // VERIFY ListAgentsRequest field name
  const hit = found.find((a) => a.name === name);
  if (hit) await client.agents.update(hit.id, { manifest });
  else await client.agents.create({ name, description, manifest });
  console.log(`${hit ? "updated" : "created"} ${name} (model ${model}, editor ${editor})`);
}
