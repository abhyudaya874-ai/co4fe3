import * as vscode from "vscode";
import { TrueForge } from "@truefoundry/trueforge-sdk";
import type { McpHttp } from "@co4fe3/agent-core";
import { ONCE } from "@co4fe3/agent-core";
import { sha256Hex } from "@co4fe3/agent-core";
import { realSleep } from "@co4fe3/agent-core";

export const mcpServerNameFor = (root: string): string => `co4fe3-ws-${sha256Hex(root).slice(0, 8)}`;

const countTools = (r: unknown): number => {
  const data = (r as { data?: unknown[] }).data;
  return Array.isArray(data) ? data.length : 0;
};

/** Registers our MCP server in TrueForge, with backoff (TrueForge may start after VS Code). Never awaited by activate(). */
export async function registerEditorServer(client: TrueForge, name: string, mcp: McpHttp, status: { setTrueforge(s: "connected" | "waiting" | "down" | "starting", d: string): void; setTools(n: number): void }, out: vscode.LogOutputChannel): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {                  // TrueForge may start after VS Code
    try {
      await client.settings.mcpServers.createOrUpdate({ manifest: { type: "remote", name, url: mcp.url, description: "co4fe3 editor tools for one VS Code window", auth: { type: "header", headers: { Authorization: `Bearer ${mcp.token}` } } } }, ONCE);
      const tools = await client.mcpServers.listTools(name, ONCE);   // TrueForge called OUR tools/list: end-to-end proof
      status.setTrueforge("connected", `${name} · ${countTools(tools)} tools`);
      status.setTools(countTools(tools));
      return;
    } catch (e) {
      status.setTrueforge("waiting", `TrueForge not reachable (${String(e).slice(0, 120)})`);
      out.info(`registerEditorServer attempt ${attempt + 1} failed: ${String(e).slice(0, 200)}`);
      await realSleep(1000 * 2 ** attempt);
    }
  }
  status.setTrueforge("down", "Start TrueForge: npm run trueforge");
}
