// The integration harness (rule 80): real TrueForge (from global-setup) + fake model + real MCP server + temp workspace.
// Workflow 02: the harness now serves createEditorMcpServer (the full tool list) over startMcpHttp.
import type { IncomingMessage } from "node:http";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrueForge } from "@truefoundry/trueforge-sdk";
import { inject } from "vitest";
import { startFakeOpenAI, toolName, type Script } from "../fakes/fake-openai.js";
import { runTurn, allow, reply, type TurnOutcome, type TfEvent, type EventIndex, type PendingCall } from "../../packages/agent-core/src/forge/turn.js";
import { createEditorMcpServer, type McpDeps } from "../../packages/agent-core/src/mcp/server.js";
import { startMcpHttp, type McpHttp } from "../../packages/agent-core/src/mcp/http.js";
import { ReviewStore } from "../../packages/agent-core/src/review/store.js";
import { Board } from "../../packages/agent-core/src/crew/board.js";
import { TurnPolicy } from "../../packages/agent-core/src/runtime/policy.js";
import type { Applier, EditorHost, FileChange } from "../../packages/agent-core/src/host.js";

declare module "vitest" {
  interface ProvidedContext { trueforgeUrl: string }
}

export interface Harness {
  fake: Awaited<ReturnType<typeof startFakeOpenAI>>;
  client: TrueForge;
  model: string;
  mcpName: string;
  root: string;
  applier: Applier & { last(): Checkpoint | undefined };
  read(rel: string): Promise<string>;
  turn(text: string, o?: { onReview?: (p: unknown) => { accept: string[] }; signal?: AbortSignal }): Promise<TurnOutcome>;
  close(): Promise<void>;
}

export interface Checkpoint { id: string; path: string; before: string | null; after: string; turnId: string }

/** An EditorHost over a plain directory (test only). Only what workflow 01's read_file needs is real. */
export function nodeTestHost(root: string): EditorHost {
  return {
    root,
    readText: async (rel: string) => {
      try { return await readFile(join(root, rel), "utf8"); } catch (e) { if ((e as { code?: string }).code === "ENOENT") return null; throw e; }
    },
    listFiles: async () => { throw new Error("nodeTestHost.listFiles is wired in workflow 02"); },
    search: async () => { throw new Error("nodeTestHost.search is wired in workflow 02"); },
    run: async () => { throw new Error("nodeTestHost.run is wired in workflow 02"); },
    problems: async () => [],
    lsp: { documentSymbols: async () => [], references: async () => [], incomingCalls: async () => [], hover: async () => [] },
    now: () => Date.now(),
  };
}

/** Writes the temp dir directly (test only; the product's single writer is extensions/…/review/apply.ts). */
function testApplier(root: string): Applier & { last(): Checkpoint | undefined; log: Checkpoint[] } {
  const log: Checkpoint[] = [];
  return {
    log,
    last: () => log.at(-1),
    apply: async (c: FileChange) => {
      const abs = join(root, c.path);
      if (!abs.startsWith(root)) return { ok: false, why: "outside_root", detail: c.path };
      if (c.before === null) await writeFile(abs, c.after, "utf8");
      else await writeFile(abs, c.after, "utf8");
      const cp: Checkpoint = { id: `cp${log.length + 1}`, path: c.path, before: c.before, after: c.after, turnId: c.turnId };
      log.push(cp);
      return { ok: true, checkpointId: cp.id };
    },
    undo: async (id: string) => {
      const cp = log.find((x) => x.id === id);
      if (!cp) return { ok: false, why: "io", detail: `no checkpoint ${id}` };
      if (cp.before === null) await rm(join(root, cp.path), { force: true });
      else await writeFile(join(root, cp.path), cp.before, "utf8");
      return { ok: true, checkpointId: cp.id };
    },
  };
}

async function readJson(req: IncomingMessage, max: number): Promise<unknown> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req as AsyncIterable<Buffer>) { n += c.length; if (n > max) throw new Error("request too large"); chunks.push(c); }
  return n ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
}

/** The editor MCP server over the harness's NodeTestHost + TestApplier (the real createEditorMcpServer since workflow 02). */
async function startTestMcp(host: EditorHost, applier: Applier): Promise<McpHttp> {
  const review = new ReviewStore();
  const board = new Board();
  const policy = new TurnPolicy("test-turn");
  const deps: McpDeps = {
    host, applier, review, board,
    index: () => null,
    instructions: async () => ({ items: [], sources: [] }),
    turn: () => ({ id: "test-turn", signal: new AbortController().signal, policy }),
    changes: () => [],
    log: () => undefined,
  };
  return await startMcpHttp(() => createEditorMcpServer(deps), () => undefined);
}

let harnessN = 0;

export async function startHarness(script: Script): Promise<Harness> {
  const n = ++harnessN;
  const base = inject("trueforgeUrl") as string;
  const client = new TrueForge({ baseUrl: base, timeoutInSeconds: 30, maxRetries: 0 });
  const fake = await startFakeOpenAI(script);
  const model = `fake-${n}/scripted`;
  await client.settings.modelProviders.createOrUpdate({
    manifest: { type: "custom", name: `fake-${n}`, baseUrl: fake.url, auth: { apiKey: "fake" }, models: [{ name: "scripted", modelId: "scripted", properties: {} }] },
  }, { timeoutInSeconds: 15, maxRetries: 0 });

  const root = await mkdtemp(join(tmpdir(), "co4fe3-ws-"));
  await cp(join(import.meta.dirname ?? ".", "../fixtures/minipkg"), root, { recursive: true });
  const host = nodeTestHost(root);
  const applier = testApplier(root);
  const mcp = await startTestMcp(host, applier);
  const mcpName = `co4fe3-test-${n}`;
  await client.settings.mcpServers.createOrUpdate({
    manifest: { type: "remote", name: mcpName, url: mcp.url, description: "integration test editor tools", auth: { type: "header", headers: { Authorization: `Bearer ${mcp.token}` } } },
  }, { timeoutInSeconds: 15, maxRetries: 0 });

  return {
    fake, client, model, mcpName, root, applier,
    read: (rel) => readFile(join(root, rel), "utf8"),
    async turn(text, o) {
      const spec = {
        model: { name: model, params: { temperature: 0, maxTokens: 4096, parallelToolCalls: true } },
        instructions: "You are a coding agent in the user's workspace. Use the editor tools. Be brief.",
        mcpServers: [{ name: mcpName, preload: true }],
        config: { askUserQuestions: { enabled: false }, generativeUi: { enabled: false }, dynamicSubAgents: { enabled: false }, iterationLimit: 16 },
      };
      const { data: session } = await client.sessions.create({ agent: { spec } }, { timeoutInSeconds: 15, maxRetries: 0 });
      const events: TfEvent[] = [];
      const hooks = {
        onEvent: (e: TfEvent, _index: EventIndex): void => { events.push(e); },
        onPause: async (pending: PendingCall[], _index: EventIndex, signal: AbortSignal) => {
          if (signal.aborted) throw new Error("aborted");
          return pending.flatMap((p) => p.kind === "approval" ? [allow(p)] : [reply(p, "")]);
        },
      };
      return await runTurn({ client, sessionId: session.id, text, signal: o?.signal ?? new AbortController().signal, hooks });
    },
    async close() {
      await client.settings.mcpServers.delete(mcpName).catch(() => undefined);
      await client.settings.modelProviders.delete(`fake-${n}`).catch(() => undefined);
      await mcp.close();
      await fake.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export { toolName };
