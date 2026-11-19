// Starts one TrueForge for the whole integration project (rule 80). Exports the URL to the tests with provide().
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrueForge } from "@truefoundry/trueforge-sdk";

const PINNED = "0.185.1";

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address() as { port: number }; srv.close(() => resolve(port)); });
    srv.on("error", reject);
  });

export const setup = async (vitest: { provide(key: string, value: unknown): void }): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), "co4fe3-int-"));
  const port = await freePort();
  const url = `http://localhost:${port}`;   // TrueForge binds ::1 (IPv6 localhost) only; 127.0.0.1 is refused
  const child = spawn("npx", ["--yes", `@truefoundry/trueforge@${PINNED}`, "--port", String(port)], {
    env: {
      ...process.env,
      SQLITE_PATH: join(dir, "tf.sqlite"),
      APP_DATA_DIR_SUFFIX: `-int-${port}`,
      // TrueForge's SSRF guard denies loopback outbound URLs; the fake model and the test MCP server are loopback.
      OUTBOUND_URL_ALLOWED_HOSTS: '["127.0.0.1", "localhost"]',
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log: string[] = [];
  child.stdout.on("data", (b: Buffer) => log.push(b.toString()));
  child.stderr.on("data", (b: Buffer) => log.push(b.toString()));
  const client = new TrueForge({ baseUrl: url, timeoutInSeconds: 3, maxRetries: 0 });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try { await client.models.list(); break; } catch {
      if (Date.now() > deadline) {
        await writeFile(join(dir, "trueforge.log"), log.join(""));
        throw new Error(`TrueForge did not come up in 60 s on ${url}; log at ${join(dir, "trueforge.log")}`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  vitest.provide("trueforgeUrl", url);
  (globalThis as { __co4fe3Trueforge?: { child: ReturnType<typeof spawn>; dir: string } }).__co4fe3Trueforge = { child, dir };
};

export const teardown = async (): Promise<void> => {
  const g = (globalThis as { __co4fe3Trueforge?: { child: ReturnType<typeof spawn>; dir: string } }).__co4fe3Trueforge;
  if (!g) return;
  g.child.kill("SIGTERM");
  setTimeout(() => g.child.kill("SIGKILL"), 3000).unref();
  await rm(g.dir, { recursive: true, force: true });
};
