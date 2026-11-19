import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type Step =
  | { text: string; chunks?: number; chunkDelayMs?: number }
  | { toolCalls: { name: string; args: unknown }[] }
  | { fail: number; message?: string }
  | { hang: true }
  | { delayMs: number; then: Step };
export type Script = Step[] | ((body: ChatBody, n: number) => Step);
export interface ChatBody { model: string; stream?: boolean; messages: { role: string; content?: unknown; tool_call_id?: string }[]; tools?: { type: string; function: { name: string; description?: string; parameters?: unknown } }[] }
export interface FakeModel { url: string; requests: { method: string; path: string; body: ChatBody | null }[]; close(): Promise<void> }

export async function startFakeOpenAI(script: Script): Promise<FakeModel> {
  const requests: FakeModel["requests"] = [];
  let n = 0;
  const server = createServer(async (req, res) => {
    const body = (await readJson(req)) as ChatBody | null;
    requests.push({ method: req.method ?? "", path: req.url ?? "", body });
    if (req.method === "GET" && req.url?.endsWith("/models")) return json(res, 200, { object: "list", data: [{ id: "scripted", object: "model" }] });
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions") || !body)
      return json(res, 404, { error: { message: `fake-openai does not serve ${req.method} ${req.url}`, type: "fake", code: 404 } }); // the spike reads this to learn what TrueForge calls
    const step = typeof script === "function" ? script(body, n++) : (script[n++] ?? { text: "Done." });
    await play(step, body, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

async function play(step: Step, body: ChatBody, res: ServerResponse): Promise<void> {
  if ("delayMs" in step) { await sleep(step.delayMs); return play(step.then, body, res); }
  if ("hang" in step) return;                                                   // never answers: tests the stall timer
  if ("fail" in step) return json(res, step.fail, { error: { message: step.message ?? `fake http ${step.fail}`, type: "fake", code: step.fail } });
  const id = `chatcmpl-${Math.random().toString(36).slice(2, 10)}`, created = Math.floor(Date.now() / 1000);
  const calls = "toolCalls" in step ? step.toolCalls.map((c, i) => ({ index: i, id: `call_${id}_${i}`, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) : [];
  const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
  if (!body.stream) {
    const message = "text" in step ? { role: "assistant", content: step.text } : { role: "assistant", content: null, tool_calls: calls.map(({ index: _i, ...c }) => c) };
    return json(res, 200, { id, object: "chat.completion", created, model: body.model, choices: [{ index: 0, message, finish_reason: calls.length ? "tool_calls" : "stop" }], usage });
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (o: object) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const chunk = (delta: object, finish: string | null = null) => ({ id, object: "chat.completion.chunk", created, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] });
  send(chunk({ role: "assistant", content: "" }));
  if ("text" in step) {
    for (const part of splitInto(step.text, step.chunks ?? 8)) { send(chunk({ content: part })); if (step.chunkDelayMs) await sleep(step.chunkDelayMs); }
    send(chunk({}, "stop"));
  } else {
    for (const c of calls) send(chunk({ tool_calls: [c] }));
    send(chunk({}, "tool_calls"));
  }
  send({ id, object: "chat.completion.chunk", created, model: body.model, choices: [], usage });
  res.end("data: [DONE]\n\n");
}

/** TrueForge may expose MCP tools under a prefixed name. Find the real one in the request. */
export function toolName(body: ChatBody, bare: string): string {
  const hit = body.tools?.map((t) => t.function.name).find((n) => n === bare || n.endsWith(`__${bare}`) || n.endsWith(`.${bare}`) || n.endsWith(`_${bare}`));
  if (!hit) throw new Error(`model request has no tool like ${bare}; it has: ${body.tools?.map((t) => t.function.name).join(", ")}`);
  return hit;
}
export const lastRole = (b: ChatBody): string => b.messages.at(-1)?.role ?? "";
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Splits on code points (Array.from), so a surrogate pair is never cut in half. */
function splitInto(text: string, parts: number): string[] {
  const chars = Array.from(text), size = Math.max(1, Math.ceil(chars.length / Math.max(1, parts)));
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(""));
  return out.length ? out : [""];
}
