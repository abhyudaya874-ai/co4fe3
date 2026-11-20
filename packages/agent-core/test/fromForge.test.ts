import { describe, it, expect } from "vitest";
import { fromForge, usageFromForge } from "../src/forge/fromForge.js";
import { mergeEventDelta } from "@truefoundry/trueforge-sdk";
import type { TfEvent, EventIndex } from "../src/forge/turn.js";

/** Recorded event shapes from the spike (docs/progress/01-spike.md), trimmed to the fields the mapping uses. */
const index = (): EventIndex => {
  const ix: EventIndex = new Map();
  ix.set("m1", { type: "model.message", id: "m1", threadId: "main", content: "hello world" } as unknown as TfEvent);
  ix.set("t1", { type: "model.message", id: "t1", threadId: "main", content: null, toolCalls: [{ id: "c1", function: { name: "read_file", arguments: "{\"path\":\"a.py\"}" }, toolInfo: { type: "mcp", name: "read_file", serverId: "co4fe3-ws-x", serverName: "co4fe3-ws-x" } }] } as unknown as TfEvent);
  return ix;
};

describe("fromForge (workflow 05 §1)", () => {
  it("a merged model.message becomes a text snapshot plus one running tool card", () => {
    const ix = index();
    const e = ix.get("t1")!;
    const out = fromForge(e, ix, { mode: "agent", serverName: "co4fe3-ws-x" });
    expect(out.some((o) => o.kind === "text" && o.id === "t1")).toBe(true);
    const tool = out.find((o) => o.kind === "tool");
    expect(tool && tool.kind === "tool" && tool.name).toBe("read_file");
    expect(tool && tool.state).toBe("running");
  });

  it("a model.message.delta emits the merged text row (regression: deltas were dropped)", () => {
    const ix = new Map<string, TfEvent>();
    const base = { type: "model.message", id: "m1", threadId: "main", content: "", toolCalls: [] } as unknown as TfEvent;
    ix.set("m1", base);
    const delta = { type: "model.message.delta", id: "m1", threadId: "main", content: "Hello!" } as unknown as TfEvent;
    mergeEventDelta(base as never, delta as never);
    const out = fromForge(delta, ix, { mode: "agent" });
    const row = out.find((o) => o.kind === "text");
    expect(row && row.kind === "text" && row.text).toBe("Hello!");
  });

  it("a tool.response becomes an ok tool card with the result", () => {
    const ix = index();
    const e = { type: "tool.response", id: "r1", threadId: "main", toolCallId: "c1", content: "file text" } as unknown as TfEvent;
    const out = fromForge(e, ix, { mode: "agent" });
    const tool = out[0]!;
    expect(tool.kind).toBe("tool");
    if (tool.kind === "tool") { expect(tool.state).toBe("ok"); expect(tool.result).toBe("file text"); }
  });

  it("a tool.response keeps the tool's name and arguments (regression: the card said \"?\" with no arguments)", () => {
    const ix = index();                                              // the call c1 lives inside event t1, not under its own id
    const out = fromForge({ type: "tool.response", id: "r1", threadId: "main", toolCallId: "c1", content: "file text" } as unknown as TfEvent, ix, { mode: "agent" });
    const tool = out[0]!;
    if (tool.kind !== "tool") throw new Error("expected a tool row");
    expect(tool.name).toBe("read_file");
    expect(tool.args).toBe("{\"path\":\"a.py\"}");
  });

  it("a tool.response for an unknown call still renders, named by what we know", () => {
    const out = fromForge({ type: "tool.response", id: "r2", threadId: "main", toolCallId: "nope", content: "x" } as unknown as TfEvent, index(), { mode: "agent" });
    expect(out[0]).toMatchObject({ kind: "tool", id: "nope", name: "tool", state: "ok" });
  });

  it("thread.created becomes a member row plus the brief; thread.done merges the row and adds the report", () => {
    const ix = index();
    const created = { type: "thread.created", id: "e1", threadId: "th9", title: "scout", agentInfo: { type: "dynamic", name: "scout", input: "PROFILE: research\nfind the tests" } } as unknown as TfEvent;
    const out1 = fromForge(created, ix, { mode: "agent" });
    expect(out1[0]!.kind).toBe("member");
    if (out1[0]!.kind === "member") expect(out1[0]!.profile).toBe("research");
    expect(out1[1]!.kind).toBe("message");
    if (out1[1]!.kind === "message") expect(out1[1]!.id).toBe("to-th9");

    const done = { type: "thread.done", id: "e2", threadId: "th9", title: "scout", state: { status: "done", output: { content: "found 3 tests" } } } as unknown as TfEvent;
    const out2 = fromForge(done, ix, { mode: "agent" });
    if (out2[0]!.kind === "member") expect(out2[0]!.status).toBe("completed");
    if (out2[1]!.kind === "message") { expect(out2[1]!.id).toBe("from-th9"); expect(out2[1]!.text).toBe("found 3 tests"); }
  });

  it("turn.done maps to the status states", () => {
    const ix = index();
    expect(fromForge({ type: "turn.done", id: "e", state: { status: "done", output: { content: "x" } } } as unknown as TfEvent, ix, { mode: "agent" })[0]).toEqual({ kind: "status", state: "done" });
    expect(fromForge({ type: "turn.done", id: "e", state: { status: "cancelled", reason: "client-cancelled" } } as unknown as TfEvent, ix, { mode: "agent" })[0]).toEqual({ kind: "status", state: "cancelled", message: "client-cancelled" });
    expect(fromForge({ type: "turn.done", id: "e", state: { status: "error", message: "boom" } } as unknown as TfEvent, ix, { mode: "agent" })[0]).toEqual({ kind: "status", state: "error", message: "boom" });
  });

  it("a compaction marker and an unknown event", () => {
    const ix = index();
    expect(fromForge({ type: "thread.context_compaction_started", id: "e", threadId: "main" } as unknown as TfEvent, ix, { mode: "agent" })[0]?.kind).toBe("marker");
    expect(fromForge({ type: "mcp.initialize", id: "e" } as unknown as TfEvent, ix, { mode: "agent" })).toEqual([]);
  });
});

describe("usageFromForge: the context meter's numbers", () => {
  // Recorded from a real run on nvidia-nim/nemotron-super (19 Nov 2026): the model.message has NO usage; the last model.message.delta has it.
  const usage = { inputTokens: 408, outputTokens: 64, cacheReadTokens: 0, inputTokensBreakdown: { harness: 213, skills: 0, instructions: 5, toolDefinitions: 0, messages: 190 } };
  const ctx = { turnId: "t1", model: "nvidia-nim/nemotron-super", window: 262_144 };
  const whole = { type: "model.message", id: "m1", threadId: "main", content: "", finishReason: null } as unknown as TfEvent;
  const last = { type: "model.message.delta", id: "m1", threadId: "main", finishReason: "length", usage } as unknown as TfEvent;
  const mid = { type: "model.message.delta", id: "m1", threadId: "main", content: "Hel" } as unknown as TfEvent;

  it("reads the usage from the last delta of a streamed message (regression: only model.message was checked, so the meter never appeared)", () => {
    expect(usageFromForge(whole, ctx)).toBeNull();
    expect(usageFromForge(mid, ctx)).toBeNull();
    expect(usageFromForge(last, ctx)).toEqual({
      kind: "usage", turnId: "t1", model: "nvidia-nim/nemotron-super", inputTokens: 408, outputTokens: 64, cacheReadTokens: 0, window: 262_144,
      breakdown: { harness: 213, skills: 0, instructions: 5, toolDefinitions: 0, messages: 190 },
    });
  });
  it("also reads it from a message that arrives whole", () => {
    const e = { type: "model.message", id: "m2", threadId: "main", content: "hi", usage } as unknown as TfEvent;
    expect(usageFromForge(e, ctx)).toMatchObject({ kind: "usage", inputTokens: 408, outputTokens: 64 });
  });
  it("an unknown window stays null (the ring then shows the token count only), and a missing cache figure is left out", () => {
    const { cacheReadTokens: _gone, ...bare } = usage;
    const e = { type: "model.message.delta", id: "m3", threadId: "main", usage: bare } as unknown as TfEvent;
    const out = usageFromForge(e, { ...ctx, window: null });
    expect(out).toMatchObject({ window: null }); expect(out).not.toHaveProperty("cacheReadTokens");
  });
  it("a crew member's calls are not the lead's context", () => {
    const member = { ...(last as object), threadId: "th9" } as unknown as TfEvent;
    expect(usageFromForge(member, { ...ctx, skipThreads: new Set(["th9"]) })).toBeNull();
    expect(usageFromForge(member, ctx)).not.toBeNull();
  });
  it("other events carry none", () => {
    expect(usageFromForge({ type: "turn.done", id: "e", state: { status: "done" } } as unknown as TfEvent, ctx)).toBeNull();
    expect(usageFromForge({ type: "tool.response", id: "e", threadId: "main", toolCallId: "c", content: "x", usage } as unknown as TfEvent, ctx)).toBeNull();
  });
});
