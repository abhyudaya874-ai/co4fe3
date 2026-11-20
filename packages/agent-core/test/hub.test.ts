import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hub, type HubPort, type HubStore } from "../src/panel/hub.js";
import type { HostMessage, PersistedSession, SessionSummary } from "../src/panel/protocol.js";
import type { PanelEvent } from "../src/panel/events.js";

const memoryStore = (): HubStore & { data: Map<string, PersistedSession> } => {
  const data = new Map<string, PersistedSession>();
  return {
    data,
    list: () => [...data.values()].map((s): SessionSummary => ({ id: s.id, title: s.title, updatedAt: s.updatedAt, running: false })),
    load: async (id) => data.get(id) ?? null,
    put: (s) => { data.set(s.id, structuredClone(s)); },
    remove: (id) => { data.delete(id); },
  };
};
const port = (): HubPort & { got: HostMessage[]; events: () => HostMessage[] } => {
  const got: HostMessage[] = [];
  return { got, post: (m) => { got.push(m); }, events: () => got.filter((m) => m.type === "events") };
};
const user = (text: string, turnId = "t1"): PanelEvent => ({ kind: "user", turnId, text });
const text = (t: string): PanelEvent => ({ kind: "text", id: "m1", threadId: "main", text: t, reasoning: "" });

let clock = 1_000;
let n = 0;
const make = (store = memoryStore()) => ({ store, hub: new Hub({ store, now: () => clock, newId: () => `s${++n}`, batchMs: 33, persistMs: 1500 }) });

beforeEach(() => { vi.useFakeTimers(); clock = 1_000; n = 0; });
afterEach(() => { vi.useRealTimers(); });

describe("Hub fan-out", () => {
  it("batches transcript events per port (one post per window, last snapshot wins) and sends status at once", () => {
    const { hub } = make(); const a = port(), b = port();
    hub.attach(a); hub.attach(b);
    hub.push(user("hi")); hub.push(text("hel")); hub.push(text("hello"));
    expect(a.events()).toEqual([]);                                 // still inside the 33 ms window
    vi.advanceTimersByTime(40);
    expect(a.events()).toHaveLength(1);
    const m = a.events()[0]!;
    if (m.type !== "events") throw new Error("expected events");
    expect(m.batch).toEqual([user("hi"), text("hello")]);
    expect(b.events()).toEqual(a.events());
    hub.push({ kind: "status", state: "done" });
    expect(a.events().at(-1)).toMatchObject({ type: "events", batch: [{ kind: "status", state: "done" }] });
  });

  it("a detached port gets nothing more", () => {
    const { hub } = make(); const a = port();
    const off = hub.attach(a);
    off();
    hub.push(user("hi")); vi.advanceTimersByTime(100);
    expect(a.got).toEqual([]);
  });

  it("a webview that throws on post does not stop the others", () => {
    const { hub } = make(); const bad: HubPort = { post: () => { throw new Error("disposed"); } }; const ok = port();
    hub.attach(bad); hub.attach(ok);
    hub.push(user("hi")); vi.advanceTimersByTime(40);
    expect(ok.events()).toHaveLength(1);
  });
});

describe("Hub snapshot", () => {
  it("a webview that opens late gets the transcript, the chrome and the sessions; its queued events are not sent twice", () => {
    const { hub } = make();
    hub.push(user("fix the redirect")); hub.push(text("working"));
    const late = port(); hub.attach(late);
    hub.push(text("working on it"));                                // queued for `late`, not yet flushed
    hub.hello(late);
    vi.advanceTimersByTime(100);
    expect(late.got.map((m) => m.type)).toEqual(["snapshot", "chrome", "sessions"]);
    const snap = late.got[0]!;
    if (snap.type !== "snapshot") throw new Error("expected snapshot");
    expect(snap.events).toEqual([user("fix the redirect"), text("working on it")]);
  });
});

describe("Hub chrome", () => {
  it("sends only what changed, and busy follows the status events", () => {
    const { hub } = make(); const a = port(); hub.attach(a);
    hub.setChrome({ model: "nvidia-nim/nemotron-super", folder: "flask" });
    hub.setChrome({ model: "nvidia-nim/nemotron-super" });          // no change: nothing sent
    expect(a.got.filter((m) => m.type === "chrome")).toHaveLength(1);
    hub.push({ kind: "status", state: "running" });
    expect(hub.chrome.busy).toBe(true);
    hub.push({ kind: "status", state: "done" });
    expect(hub.chrome.busy).toBe(false);
  });
});

describe("Hub sessions", () => {
  it("titles the session from the first message, lists it, and stores it after the debounce", () => {
    const { hub, store } = make();
    expect(hub.summaries()).toEqual([]);                            // an empty session is not listed
    hub.push(user("Add a --verbose flag\nplease"));
    expect(hub.summaries()).toMatchObject([{ id: "s1", title: "Add a --verbose flag", running: false }]);
    expect(store.data.size).toBe(0);
    vi.advanceTimersByTime(1600);
    expect(store.data.get("s1")).toMatchObject({ v: 1, title: "Add a --verbose flag" });
  });

  it("new session stores the old one and starts empty; switching restores it with no live run", async () => {
    const { hub, store } = make();
    hub.push(user("first")); hub.push({ kind: "status", state: "done" });
    expect(hub.newSession()).toBe(true);
    expect(store.data.has("s1")).toBe(true);
    expect(hub.activeId).toBe("s2");
    expect(hub.panel.order).toEqual([]);
    hub.push(user("second")); hub.push({ kind: "status", state: "done" });
    clock += 5_000;
    expect(await hub.switchTo("s1")).toBe(true);
    expect(hub.panel.order.map((r) => r.e)).toEqual([user("first")]);
    expect(store.data.has("s2")).toBe(true);                        // the one we left was stored on the way out
  });

  it("refuses to switch, start or delete the active session while a turn runs", async () => {
    const { hub, store } = make();
    store.put({ v: 1, id: "old", title: "old", createdAt: 1, updatedAt: 2, events: [user("old")] });
    hub.push(user("busy")); hub.push({ kind: "status", state: "running" });
    expect(hub.newSession()).toBe(false);
    expect(await hub.switchTo("old")).toBe(false);
    expect(hub.remove(hub.activeId)).toBe(false);
    expect(hub.remove("old")).toBe(true);                           // a stored one can still go
    expect(store.data.has("old")).toBe(false);
  });

  it("a restored session keeps the TrueForge session it continues with", async () => {
    const { hub, store } = make();
    hub.push(user("one")); hub.forge = { sessionId: "tf-1", model: "m", mode: "agent", instr: "abc" };
    hub.push({ kind: "status", state: "done" });
    hub.newSession();
    expect(hub.forge).toBeUndefined();
    await hub.switchTo("s1");
    expect(hub.forge).toEqual({ sessionId: "tf-1", model: "m", mode: "agent", instr: "abc" });
    expect(store.data.get("s1")?.forge?.sessionId).toBe("tf-1");
  });

  it("Stop then a new message: busy follows the LAST status, and a fresh session is allowed once it ends", () => {
    const { hub } = make();
    hub.push(user("one")); hub.push({ kind: "status", state: "running" });
    hub.push({ kind: "status", state: "stopping" });
    expect(hub.chrome.busy).toBe(true);
    hub.push({ kind: "status", state: "cancelled", message: "client-cancelled" });
    expect(hub.chrome.busy).toBe(false);
    hub.push(user("two", "t2")); hub.push({ kind: "status", state: "running" });
    expect(hub.chrome.busy).toBe(true);
    hub.push({ kind: "status", state: "done" });
    expect(hub.chrome.busy).toBe(false);
    expect(hub.newSession()).toBe(true);
  });

  it("sessions are re-sent to every webview when the list changes", () => {
    const { hub } = make(); const a = port(); hub.attach(a);
    hub.push(user("hello"));
    expect(a.got.some((m) => m.type === "sessions" && m.items.length === 1)).toBe(true);
  });

  it("a diff card can be found by its proposal key", () => {
    const { hub } = make();
    const card: PanelEvent = { kind: "proposal", key: "k1", path: "a.py", why: "w", by: "lead", adds: 1, removes: 0, hunks: [], verdict: {} };
    hub.push(card);
    expect(hub.proposal("k1")).toEqual(card);
    expect(hub.proposal("nope")).toBeUndefined();
  });
});
