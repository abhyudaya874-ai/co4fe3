import { describe, it, expect } from "vitest";
import { applyPanelEvent, emptyPanel, rowId, type PanelState } from "../src/panel/reducer.js";
import { coalesce } from "../src/panel/coalesce.js";
import type { PanelEvent } from "../src/panel/events.js";

const user: PanelEvent = { kind: "user", turnId: "t1", text: "hi" };
const text1: PanelEvent = { kind: "text", id: "m1", threadId: "main", text: "hel", reasoning: "" };
const text1b: PanelEvent = { kind: "text", id: "m1", threadId: "main", text: "hello", reasoning: "" };
const tool1: PanelEvent = { kind: "tool", id: "c1", threadId: "main", name: "read_file", args: "{}", state: "running" };
const tool1b: PanelEvent = { kind: "tool", id: "c1", threadId: "main", name: "read_file", args: "{}", state: "ok", result: "…" };
const member1: PanelEvent = { kind: "member", threadId: "th1", title: "scout", profile: "research", status: "running" };
const member1b: PanelEvent = { kind: "member", threadId: "th1", title: "scout", status: "completed" };

describe("reducer (rule 50 §3, workflow 05)", () => {
  it("same (kind,id) replaces in place; new rows append", () => {
    let s: PanelState = emptyPanel();
    s = applyPanelEvent(s, user);
    s = applyPanelEvent(s, text1);
    s = applyPanelEvent(s, text1b);
    expect(s.order.map((r) => r.id)).toEqual([rowId(user), rowId(text1)]);
    expect((s.byId[rowId(text1)]!.e as typeof text1b).text).toBe("hello");
  });

  it("member rows merge, keeping the profile from thread.created", () => {
    let s = emptyPanel();
    s = applyPanelEvent(s, member1);
    s = applyPanelEvent(s, member1b);
    const row = s.byId[rowId(member1)]!.e as typeof member1;
    expect(row.status).toBe("completed");
    expect(row.profile).toBe("research");
  });

  it("replaying the same batch twice gives the same state", () => {
    const batch = [user, text1, text1b, tool1, tool1b, member1, member1b];
    const s1 = batch.reduce(applyPanelEvent, emptyPanel());
    const s2 = batch.reduce(applyPanelEvent, emptyPanel());
    expect(s1).toEqual(s2);
  });

  it("status and board live outside the row order", () => {
    let s = emptyPanel();
    s = applyPanelEvent(s, { kind: "status", state: "running" });
    s = applyPanelEvent(s, { kind: "board", entries: [{ key: "k", value: "v", by: "b", at: 1 }] });
    expect(s.status?.state).toBe("running");
    expect(s.board).toEqual([{ key: "k", value: "v", by: "b", at: 1 }]);
    expect(s.order).toEqual([]);
  });
});

describe("coalesce", () => {
  it("keeps the last snapshot per row id and the first-seen order", () => {
    const out = coalesce([user, text1, tool1, text1b, tool1b]);
    expect(out.map((e) => rowId(e))).toEqual([rowId(user), rowId(text1), rowId(tool1)]);
    expect((out[1] as typeof text1b).text).toBe("hello");
    expect((out[2] as typeof tool1b).state).toBe("ok");
  });
});
