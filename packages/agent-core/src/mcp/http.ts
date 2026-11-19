import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface McpHttp { url: string; token: string; close(): Promise<void> }

/** One McpServer per request (stateless mode, as the SDK documents). Shared state lives in the closure of `make`. */
export async function startMcpHttp(make: () => McpServer, log: (line: string) => void): Promise<McpHttp> {
  const token = randomBytes(24).toString("base64url");
  const want = Buffer.from(`Bearer ${token}`);
  let port = 0;
  const http = createServer(async (req, res) => {
    const got = Buffer.from(req.headers.authorization ?? "");
    if (got.length !== want.length || !timingSafeEqual(got, want)) return void res.writeHead(401).end();
    if (req.headers.host !== `127.0.0.1:${port}`) return void res.writeHead(403).end();      // DNS-rebinding guard
    const peer = req.socket.remoteAddress ?? "";
    if (peer !== "127.0.0.1" && peer !== "::1" && peer !== "::ffff:127.0.0.1") return void res.writeHead(403).end();  // loopback peers only (V3Code isLoopbackEndpoint)
    if (!req.url?.startsWith("/mcp")) return void res.writeHead(404).end();
    if (req.method !== "POST") return void res.writeHead(405, { allow: "POST" }).end();      // stateless: no GET stream
    try {
      const body = await readJson(req, 4_000_000);
      const server = make();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      log(`mcp error ${e instanceof Error ? e.message : String(e)}`);
      if (!res.headersSent) res.writeHead(400).end();
    }
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  port = (http.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/mcp`, token, close: () => new Promise((r) => { http.closeAllConnections(); http.close(() => r()); }) };
}

async function readJson(req: IncomingMessage, max: number): Promise<unknown> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req as AsyncIterable<Buffer>) { n += c.length; if (n > max) throw new Error("request too large"); chunks.push(c); }
  return n ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
}
