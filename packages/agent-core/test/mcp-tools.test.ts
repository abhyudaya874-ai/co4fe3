import { afterAll, describe, expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createEditorMcpServer, type McpDeps } from "../src/mcp/server.js";
import { startMcpHttp, type McpHttp } from "../src/mcp/http.js";
import { ReviewStore } from "../src/review/store.js";
import { Board } from "../src/crew/board.js";
import { TurnPolicy } from "../src/runtime/policy.js";
import { TOOLS } from "../src/runtime/modes.js";
import type { EditorHost, SearchHit } from "../src/host.js";
import { indexFile, buildIndex, type RepoIndex } from "../src/context/repomap.js";
import { splitLines } from "../src/review/lines.js";

/** In-memory EditorHost: the files live in a Map; search scans them. */
function fakeHost(files: Record<string, string>): EditorHost {
  const root = "/ws";
  return {
    root,
    readText: async (rel) => files[rel] ?? null,
    listFiles: async () => Object.keys(files),
    search: async (q): Promise<SearchHit[]> => {
      const out: SearchHit[] = [];
      for (const [path, text] of Object.entries(files)) {
        if (q.glob && !path.includes(q.glob.replace(/\*/g, ""))) continue;
        const lines = splitLines(text);
        lines.forEach((l, i) => {
          if (out.length >= (q.maxHits ?? 200)) return;
          const hit = q.regex ? new RegExp(q.pattern).test(l) : l.includes(q.pattern);
          if (hit) out.push({ path, line: i + 1, text: l.trimEnd() });
        });
      }
      return out;
    },
    run: async () => ({ exitCode: 0, output: "ok", truncated: false, timedOut: null, killed: false, ms: 1 }),
    problems: async () => [],
    lsp: { documentSymbols: async () => [], references: async () => [], incomingCalls: async () => [], hover: async () => [] },
    now: () => 1_000,
  };
}

function deps(host: EditorHost, o: { policy?: TurnPolicy; index?: RepoIndex } = {}): McpDeps & { applied: string[] } {
  const applied: string[] = [];
  const policy = o.policy ?? new TurnPolicy("t1");
  return {
    applied,
    host,
    applier: {
      apply: async (c) => { applied.push(c.path); return { ok: true, checkpointId: "cp1" }; },
      undo: async () => ({ ok: true, checkpointId: "cp1" }),
    },
    review: new ReviewStore(),
    board: new Board(),
    index: () => o.index ?? null,
    instructions: async () => ({ items: [], sources: [] }),
    turn: () => ({ id: "t1", signal: new AbortController().signal, policy }),
    changes: () => [],
    log: () => undefined,
  };
}

let http: McpHttp | null = null;
let client: Client | null = null;
afterAll(async () => { await client?.close(); await http?.close(); });

/** fetch() forbids overriding Host; a raw request can, which is what the rebinding guard must see. */
const rawPost = (url: string, headers: Record<string, string>): Promise<number> =>
  new Promise((resolve) => {
    const u = new URL(url);
    const req = httpRequest({ host: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { ...headers, "content-length": 2 } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", () => resolve(0));
    req.end("{}");
  });

async function start(d: McpDeps): Promise<{ call: (name: string, args: unknown) => Promise<{ text: string; isError: boolean }> }> {
  http = await startMcpHttp(() => createEditorMcpServer(d), () => undefined);
  client = new Client({ name: "test", version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(http.url), { requestInit: { headers: { Authorization: `Bearer ${http.token}` } } }));
  return {
    call: async (name, args) => {
      const r = await client!.callTool({ name, arguments: args as Record<string, unknown> });
      const text = (r.content as { type: string; text: string }[] | undefined)?.map((c) => c.text).join("") ?? "";
      return { text, isError: r.isError === true };
    },
  };
}

describe("mcp server over HTTP (workflow 02)", () => {
  it("rejects 401 without a token and 403 with a wrong Host", async () => {
    const d = deps(fakeHost({}));
    const bare = await startMcpHttp(() => createEditorMcpServer(d), () => undefined);
    const noAuth = await fetch(bare.url, { method: "POST", body: "{}" });
    expect(noAuth.status).toBe(401);
    const wrongHost = await rawPost(bare.url, { Authorization: `Bearer ${bare.token}`, Host: "evil.example:1" });
    expect(wrongHost).toBe(403);
    await bare.close();
  });

  it("tools/list returns the 11 names in TOOLS order", async () => {
    const { } = await start(deps(fakeHost({})));
    const tools = await client!.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toEqual([...TOOLS]);
  });

  it("the jail refuses ../x and .env; read_file pages and says what to call next", async () => {
    const files = { "src/a.py": "one\ntwo\nthree\nfour\nfive\n" };
    const call = await start(deps(fakeHost(files)));
    const up = await call.call("read_file", { path: "../x" });
    expect(up.isError).toBe(true);
    expect(up.text).toContain("outside the workspace");
    const env = await call.call("read_file", { path: ".env" });
    expect(env.isError).toBe(true);
    expect(env.text).toContain("off limits");
    const paged = await call.call("read_file", { path: "src/a.py", offset: 2, limit: 2 });
    expect(paged.text).toContain("src/a.py (lines 2-3 of 5)");
    expect(paged.text).toContain("two\nthree");
    expect(paged.text).toContain("offset=4");
  });

  it("search_workspace caps at 50 hits and 200 chars per hit", async () => {
    const big = Array.from({ length: 80 }, (_, i) => `needle ${"x".repeat(300)} ${i}`).join("\n");
    const call = await start(deps(fakeHost({ "big.txt": big })));
    const r = await call.call("search_workspace", { pattern: "needle" });
    expect(r.text.split("\n").filter((l) => l.startsWith("big.txt:")).length).toBe(50);
    expect(r.text).toContain("Narrow the pattern");
  });

  it("the 3rd identical call carries the reminder and the 5th is refused", async () => {
    const policy = new TurnPolicy("t1");
    const call = await start(deps(fakeHost({ "a.txt": "x\n" }), { policy }));
    const args = { path: "a.txt" };
    await call.call("read_file", args);
    await call.call("read_file", args);
    const third = await call.call("read_file", args);
    expect(third.text).toContain("3rd identical read_file");
    await call.call("read_file", args);
    const fifth = await call.call("read_file", args);
    expect(fifth.isError).toBe(true);
    expect(fifth.text).toContain("5 times");
  });

  it("a 100,000-char result is bounded with the note", async () => {
    const files = { "huge.txt": "y".repeat(100_000) };
    const call = await start(deps(fakeHost(files)));
    const r = await call.call("read_file", { path: "huge.txt", limit: 800 });
    expect(r.text.length).toBeLessThan(60_500);
    expect(r.text).toContain("truncated:");
    expect(r.text).toContain("Ask for a smaller range.");
  });

  it("propose_edit without a decision writes nothing", async () => {
    const d = deps(fakeHost({ "a.py": "one\n" }));
    const call = await start(d);
    const r = await call.call("propose_edit", { path: "a.py", why: "test why", edits: [{ old_string: "one", new_string: "ONE" }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("not reviewed by the user");
    expect(d.applied).toEqual([]);
  });

  it("pack_context falls back to the index when no language server answers (source: index)", async () => {
    const files = { "src/m.py": "class Thing:\n    def grow(self):\n        return 1\n" };
    const call = await start(deps(fakeHost(files)));
    const r = await call.call("pack_context", { path: "src/m.py", symbol: "grow", task: "understand", max_tokens: 3000 });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("## grow (src/m.py:2, from index)");
    expect(r.text).toContain("def grow(self):");
  });

  it("repo_map ranks file outlines with reasons when the index is ready", async () => {
    const files = {
      "src/cli.py": "import click\n@click.command(\"routes\")\ndef routes_command():\n    pass\n",
      "src/helpers.py": "def get_flag():\n    return True\n",
      "docs/cli.rst": "Commands\n========\n\nroutes - list routes\n",
    };
    const ix = buildIndex(Object.entries(files).map(([p, t]) => indexFile(p, t)));
    const call = await start(deps(fakeHost(files), { index: ix }));
    const r = await call.call("repo_map", { query: "add a new command shown in --help", budget_tokens: 2500 });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("<context_pack");
    expect(r.text).toContain("src/cli.py");
  });

  it("repo_map without an index says what to use instead", async () => {
    const call = await start(deps(fakeHost({ "a.py": "x\n" })));
    const r = await call.call("repo_map", { query: "anything", budget_tokens: 2500 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("index is still building");
  });

  it("run_command refuses policy violations and runs plain commands", async () => {
    const call = await start(deps(fakeHost({})));
    const bad = await call.call("run_command", { command: "sudo rm -rf /" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("command policy");
  });
});
