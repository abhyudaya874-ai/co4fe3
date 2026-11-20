import { TrueForge } from "@truefoundry/trueforge-sdk";
import type { AgentSpec } from "@co4fe3/agent-core";
import { ONCE } from "@co4fe3/agent-core";
import * as vscode from "vscode";
import type { McpHttp } from "@co4fe3/agent-core";
import { sha256Hex, realSleep } from "@co4fe3/agent-core";

export const mcpServerNameFor = (root: string): string => `co4fe3-ws-${sha256Hex(root).slice(0, 8)}`;

const countTools = (r: unknown): number => {
  const data = (r as { data?: unknown[] }).data;
  return Array.isArray(data) ? data.length : 0;
};

/** Registers our MCP server in TrueForge, with backoff (TrueForge may start after VS Code). Never awaited by activate(). */
export async function registerEditorServer(getClient: () => TrueForge, name: string, mcp: McpHttp, status: { setTrueforge(s: "connected" | "waiting" | "down" | "starting", d: string): void; setTools(n: number): void }, out: vscode.LogOutputChannel): Promise<void> {
  for (let attempt = 0; ; attempt++) {                             // TrueForge may start after VS Code, or the URL may change
    try {
      await getClient().settings.mcpServers.createOrUpdate({ manifest: { type: "remote", name, url: mcp.url, description: "co4fe3 editor tools for one VS Code window", auth: { type: "header", headers: { Authorization: `Bearer ${mcp.token}` } } } }, ONCE);
      const tools = await getClient().mcpServers.listTools(name, ONCE);   // TrueForge called OUR tools/list: end-to-end proof
      status.setTrueforge("connected", `${name} · ${countTools(tools)} tools`);
      status.setTools(countTools(tools));
      return;
    } catch (e) {
      status.setTrueforge("waiting", `TrueForge not reachable (${String(e).slice(0, 120)})`);
      if (attempt < 3) out.info(`registerEditorServer attempt ${attempt + 1} failed: ${String(e).slice(0, 200)}`);
      await realSleep(Math.min(10_000, 1000 * 2 ** Math.min(attempt, 4)));
    }
  }
}

/** Pre-warmed sessions, one spare per (mode, model), created while the user is still typing (rule 60, lever 3). */
export class SessionPool {
  private warm_ = new Map<string, { id: string; model: string }>();
  private creating = new Map<string, Promise<{ id: string; model: string }>>();

  constructor(private getClient: () => TrueForge, private spec: (mode: "inline" | "agent" | "ask" | "plan", model: string) => AgentSpec) {}

  /** Starts creating a spare session; never throws (the caller only logs). */
  warm(mode: "inline" | "agent", model: string): void {
    const key = `${mode}:${model}`;
    if (this.warm_.has(key) || this.creating.has(key)) return;
    const p = this.create(mode, model);
    this.creating.set(key, p);
    void p.then((s) => { this.creating.delete(key); this.warm_.set(key, s); }, () => this.creating.delete(key));
  }

  /** Takes the warm session, or creates one now. */
  async take(mode: "inline" | "agent", model: string): Promise<{ id: string; model: string }> {
    const key = `${mode}:${model}`;
    const warm = this.warm_.get(key);
    if (warm) { this.warm_.delete(key); this.warm(mode, model); return warm; }   // refill the spare
    const creating = this.creating.get(key);
    if (creating) { this.creating.delete(key); const s = await creating; this.warm(mode, model); return s; }
    return await this.create(mode, model);
  }

  /** The chat session for the panel: one per mode, reused across turns. */
  async agent(instructions: string, mode: "agent" | "ask" | "plan", model: string): Promise<{ id: string; model: string }> {
    const spec = this.spec(mode, model);                                // the mode decides the tools (rule 50 §1)
    const { data: session } = await this.getClient().sessions.create({ agent: { spec: { ...spec, instructions } } }, ONCE);
    return { id: session.id, model };
  }

  private async create(mode: "inline" | "agent", model: string): Promise<{ id: string; model: string }> {
    const spec = this.spec(mode, model);
    const { data: session } = await this.getClient().sessions.create({ agent: { spec } }, ONCE);
    return { id: session.id, model };
  }
}
