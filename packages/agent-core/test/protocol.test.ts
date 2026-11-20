import { describe, it, expect } from "vitest";
import { UI_MODES, runtimeOf, uiModeOf, nextUiMode, sessionTitle, relativeAge, compactEvents, restoreEvents, selectionLabel, parseUiCommand, type UiMode } from "../src/panel/protocol.js";
import { applyPanelBatch, emptyPanel, panelEvents } from "../src/panel/reducer.js";
import type { PanelEvent } from "../src/panel/events.js";

describe("modes", () => {
  it("every UI mode round-trips through the runtime mode", () => {
    for (const m of UI_MODES) {
      const r = runtimeOf(m.id);
      expect(uiModeOf(r.mode, r.autoApproveCommands)).toBe(m.id);
    }
  });
  it("bypass is Code plus auto-approved commands; ask and plan never auto-approve", () => {
    expect(runtimeOf("bypass")).toEqual({ mode: "agent", autoApproveCommands: true });
    expect(runtimeOf("code")).toEqual({ mode: "agent", autoApproveCommands: false });
    expect(runtimeOf("ask").autoApproveCommands).toBe(false);
    expect(runtimeOf("plan").autoApproveCommands).toBe(false);
  });
  it("Ctrl+. visits all four modes and comes back", () => {
    const seen: UiMode[] = [];
    let m: UiMode = "code";
    for (let i = 0; i < 4; i++) { seen.push(m); m = nextUiMode(m); }
    expect(new Set(seen).size).toBe(4);
    expect(m).toBe("code");
  });
});

describe("sessionTitle", () => {
  it("uses the first non-empty line, collapses spaces, trims to 60 characters", () => {
    expect(sessionTitle("\n\n  fix   the redirect  \nmore")).toBe("fix the redirect");
    const long = sessionTitle("x".repeat(100));
    expect(long).toHaveLength(60);
    expect(long.endsWith("…")).toBe(true);
  });
  it("an empty message gets a placeholder", () => { expect(sessionTitle("  \n ")).toBe("New session"); });
});

describe("relativeAge", () => {
  const now = Date.UTC(2026, 10, 20, 12, 0, 0);
  const ago = (ms: number): string => relativeAge(now - ms, now);
  const MIN = 60_000, H = 3_600_000, D = 86_400_000;
  it("reads like the Devin session list", () => {
    expect(ago(10_000)).toBe("just now");
    expect(ago(MIN)).toBe("1 minute ago");
    expect(ago(51 * MIN)).toBe("51 minutes ago");
    expect(ago(2 * H)).toBe("2 hours ago");
    expect(ago(30 * H)).toBe("yesterday");
    expect(ago(5 * D)).toBe("5 days ago");
    expect(ago(60 * D)).toBe("2026-09-21");
  });
  it("a timestamp in the future is just now", () => { expect(relativeAge(now + 5000, now)).toBe("just now"); });
});

const events: PanelEvent[] = [
  { kind: "user", turnId: "t1", text: "hi" },
  { kind: "text", id: "m1", threadId: "main", text: "hello", reasoning: "r" },
  { kind: "tool", id: "c1", threadId: "main", name: "read_file", args: "{}", state: "ok", result: "x".repeat(5000) },
  { kind: "tool", id: "c2", threadId: "main", name: "search_workspace", args: "{}", state: "running" },
  { kind: "command", id: "cmd-1", command: "pytest", state: "running", output: "y".repeat(5000) },
  { kind: "proposal", key: "k1", path: "a.py", why: "w", by: "lead", adds: 1, removes: 1, hunks: [{ id: "h1", oldStart: 0, oldLines: ["a"], newLines: ["b"] }], verdict: { h1: "pending" } },
  { kind: "proposal", key: "k2", path: "b.py", why: "w", by: "lead", adds: 1, removes: 0, hunks: [{ id: "h1", oldStart: 0, oldLines: [], newLines: ["b"] }], verdict: { h1: "accepted" }, applied: { checkpointId: "cp1", newErrors: [] } },
  { kind: "member", threadId: "th1", title: "scout", status: "running" },
  { kind: "status", state: "running" },
];

describe("compactEvents / restoreEvents (stored transcripts)", () => {
  it("long tool results and command output are cut, nothing else changes", () => {
    const out = compactEvents(events);
    const tool = out[2]!; const cmd = out[4]!;
    if (tool.kind !== "tool" || cmd.kind !== "command") throw new Error("shape");
    expect(tool.result!.length).toBeLessThan(2100);
    expect(cmd.output!.length).toBeLessThan(2100);
    expect(out[1]).toEqual(events[1]);
  });
  it("a loaded session has no live run: running things end, undecided diffs are dropped, applied ones stay", () => {
    const out = restoreEvents(events);
    expect(out.find((e) => e.kind === "status")).toMatchObject({ state: "cancelled" });
    expect(out.find((e) => e.kind === "tool" && e.id === "c2")).toMatchObject({ state: "error" });
    expect(out.find((e) => e.kind === "command")).toMatchObject({ state: "denied" });
    expect(out.find((e) => e.kind === "member")).toMatchObject({ status: "cancelled" });
    expect(out.find((e) => e.kind === "proposal" && e.key === "k1")).toMatchObject({ dropped: true });
    const applied = out.find((e) => e.kind === "proposal" && e.key === "k2");
    expect(applied && applied.kind === "proposal" && applied.dropped).toBeUndefined();
  });
});

describe("panelEvents (the snapshot)", () => {
  it("replaying a snapshot into an empty panel rebuilds the same state", () => {
    const board: PanelEvent = { kind: "board", entries: [{ key: "k", value: "v", by: "b", at: 1 }] };
    const s = applyPanelBatch(emptyPanel(), [...events, board]);
    const again = applyPanelBatch(emptyPanel(), panelEvents(s));
    expect(again).toEqual(s);
  });
  it("an empty panel has an empty snapshot", () => { expect(panelEvents(emptyPanel())).toEqual([]); });
});

describe("parseUiCommand (the webview is untrusted input)", () => {
  it("accepts every command the UI sends", () => {
    const ok: unknown[] = [
      { type: "ready" }, { type: "stop" }, { type: "focus" }, { type: "newSession" }, { type: "models" }, { type: "openSession" }, { type: "pickModel" },
      { type: "send", text: "hello" }, { type: "send", text: "x", attach: { path: "a.py", start: 1, end: 3 } },
      { type: "decide", key: "k", hunkId: "h1", verdict: "accepted" }, { type: "decideAll", key: "k", verdict: "rejected" },
      { type: "openDiff", key: "k" }, { type: "openFile", path: "a.py", line: 4 }, { type: "openFile", path: "a.py" },
      { type: "command", id: "cmd-1", verdict: "allow" }, { type: "undo", checkpointId: "cp1" }, { type: "revertTurn", turnId: "t1" },
      { type: "setMode", mode: "bypass" }, { type: "complete", kind: "@", prefix: "ap" }, { type: "setModel", name: "nvidia-nim/nemotron-super" }, { type: "setModel", name: null },
      { type: "switchSession", id: "abcd-1234" }, { type: "deleteSession", id: "abcd-1234" }, { type: "setLayout", layout: "agent" },
    ];
    for (const m of ok) expect(parseUiCommand(m), JSON.stringify(m)).toEqual(m);
  });
  it("refuses anything else", () => {
    const bad: unknown[] = [
      null, 7, "send", [], {}, { type: "nope" }, { type: "send" }, { type: "send", text: "   " }, { type: "send", text: "x".repeat(50_001) },
      { type: "decide", key: "k", hunkId: "h1", verdict: "maybe" }, { type: "decide", key: 1, hunkId: "h1", verdict: "accepted" },
      { type: "setMode", mode: "yolo" }, { type: "complete", kind: "#", prefix: "" }, { type: "setLayout", layout: "zen" }, { type: "setModel", name: 5 },
      { type: "command", id: "c", verdict: "sure" }, { type: "openFile", path: 3 },
    ];
    for (const m of bad) expect(parseUiCommand(m), JSON.stringify(m)).toBeNull();
  });
  it("drops fields it does not know and a malformed attach", () => {
    expect(parseUiCommand({ type: "send", text: "hi", attach: { path: "a", start: "1", end: 2 }, extra: true })).toEqual({ type: "send", text: "hi" });
    expect(parseUiCommand({ type: "stop", extra: 1 })).toEqual({ type: "stop" });
  });
});

it("selectionLabel mirrors the composer chip (file#L13-15)", () => {
  expect(selectionLabel({ path: "app/layout.tsx", start: 13, end: 15 })).toBe("layout.tsx#L13-15");
  expect(selectionLabel({ path: "a.py", start: 4, end: 4 })).toBe("a.py#L4");
});
