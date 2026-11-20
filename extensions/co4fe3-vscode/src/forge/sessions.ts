import { TrueForge } from "@truefoundry/trueforge-sdk";
import type { AgentSpec, Mode } from "@co4fe3/agent-core";
import type { ForgeRef } from "@co4fe3/agent-core/panel";
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

/** Builds the AgentSpec for a session. `project` is the rendered project rules and AGENTS.md, appended to the lead's own instructions. */
export type SpecFor = (mode: "inline" | "agent" | "ask" | "plan", model: string, project?: string) => AgentSpec;

/** What a chat session was built from. The same values mean the TrueForge session needs no update. */
export interface ChatWant { project: string; instr: string; mode: Mode; model: string }

/** Pre-warmed sessions, one spare per (mode, model), created while the user is still typing (rule 60, lever 3). */
export class SessionPool {
  private warm_ = new Map<string, { id: string; model: string }>();
  private creating = new Map<string, Promise<{ id: string; model: string }>>();
  private known = new Set<string>();                                 // session ids this process created or confirmed

  constructor(private getClient: () => TrueForge, private spec: SpecFor) {}

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

  /**
   * The chat session for one message. The conversation keeps ONE TrueForge session, so a follow-up sees the earlier turns
   * (verified live: a second turn recalls the first, and a spec update keeps the history). `prev` is the session behind the
   * transcript; it is reused when it still exists, and only its spec is updated when the mode, the model or the project
   * rules changed. Otherwise a session is created, using the composer-focus warm spare when there is one (rule 60 lever 3).
   */
  async chat(prev: ForgeRef | undefined, want: ChatWant): Promise<ForgeRef> {
    const spec = this.spec(want.mode, want.model, want.project);          // the mode decides the tools (rule 50 §1)
    if (prev && (await this.alive(prev.sessionId))) {
      if (prev.mode === want.mode && prev.instr === want.instr && prev.model === want.model) return prev;
      try {
        await this.getClient().sessions.update(prev.sessionId, { agent: { spec } }, ONCE);
        return { sessionId: prev.sessionId, model: want.model, mode: want.mode, instr: want.instr };
      } catch { /* the session cannot be changed: continue the transcript on a new one */ }
    }
    const s = await this.take("agent", want.model);                      // warm spare, or a fresh create (take retries once)
    await this.getClient().sessions.update(s.id, { agent: { spec } }, ONCE).catch(() => undefined);   // the spare's own spec is an acceptable fallback
    this.known.add(s.id);
    return { sessionId: s.id, model: want.model, mode: want.mode, instr: want.instr };
  }

  /** A session id from a stored transcript may be gone (TrueForge restarted): ask once, remember the answer. */
  private async alive(id: string): Promise<boolean> {
    if (this.known.has(id)) return true;
    try { await this.getClient().sessions.get(id, ONCE); this.known.add(id); return true; } catch { return false; }
  }

  private async create(mode: "inline" | "agent", model: string): Promise<{ id: string; model: string }> {
    const spec = this.spec(mode, model);
    const { data: session } = await this.getClient().sessions.create({ agent: { spec } }, ONCE);
    this.known.add(session.id);
    return { id: session.id, model };
  }
}
