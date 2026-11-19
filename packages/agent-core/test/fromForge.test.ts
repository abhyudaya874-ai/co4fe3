import { describe, it, expect } from "vitest";
import { fromForge } from "../src/forge/fromForge.js";
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

  it("a tool.response becomes an ok tool card with the result", () => {
    const ix = index();
    const e = { type: "tool.response", id: "r1", threadId: "main", toolCallId: "c1", content: "file text" } as unknown as TfEvent;
    const out = fromForge(e, ix, { mode: "agent" });
    const tool = out[0]!;
    expect(tool.kind).toBe("tool");
    if (tool.kind === "tool") { expect(tool.state).toBe("ok"); expect(tool.result).toBe("file text"); }
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
