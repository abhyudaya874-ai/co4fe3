import type { PanelEvent } from "./events.js";
import { applyPanelBatch, emptyPanel, panelEvents, proposalRowId, type PanelState } from "./reducer.js";
import { coalesce } from "./coalesce.js";
import { emptyChrome, restoreEvents, compactEvents, sessionTitle, sessionStats, summaryOf, patchSession, type ChromeState, type ForgeRef, type HostMessage, type PersistedSession, type SessionPatch, type SessionSummary } from "./protocol.js";

/** One webview. The extension wraps `webview.postMessage`; tests pass a recorder. */
export interface HubPort { post(m: HostMessage): void }

/** Where finished transcripts live. The extension backs it with files under its storage folder. */
export interface HubStore {
  /** Summaries of stored sessions, any order. */
  list(): SessionSummary[];
  load(id: string): Promise<PersistedSession | null>;
  put(s: PersistedSession): void;
  remove(id: string): void;
}

export interface HubDeps {
  store: HubStore;
  now(): number;
  newId(): string;
  /** Batch window for transcript events, in ms. Status changes always go out at once. */
  batchMs?: number;
  /** How long after the first unsaved event the transcript is written. */
  persistMs?: number;
}

type ProposalEvent = Extract<PanelEvent, { kind: "proposal" }>;

/**
 * The single source of truth for what the agent UI shows. It reduces every PanelEvent into one PanelState, sends
 * batches to every attached webview (the Agent window and the dock), replays a snapshot when a webview (re)opens,
 * and keeps the session list. No `vscode` import: the extension supplies ports and a store.
 */
export class Hub {
  private state: PanelState = emptyPanel();
  private chrome_: ChromeState = emptyChrome();
  private ports = new Map<HubPort, { q: PanelEvent[]; timer: ReturnType<typeof setTimeout> | null }>();
  private id: string;
  private createdAt: number;
  private title = "New session";
  private forge_: ForgeRef | undefined;
  private meta = { pinned: false, archived: false, renamed: false };            // what the person did to this session in the list
  private lastTouched = 0;
  private dirty = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private d: HubDeps) {
    this.id = d.newId();
    this.createdAt = d.now();
  }

  // ── ports ──────────────────────────────────────────────────────────────────
  attach(port: HubPort): () => void {
    this.ports.set(port, { q: [], timer: null });
    return () => { const p = this.ports.get(port); if (p?.timer) clearTimeout(p.timer); this.ports.delete(port); };
  }

  /** A webview said "ready" (first paint or after a reload): send it everything, from the current state. */
  hello(port: HubPort): void {
    const p = this.ports.get(port);
    if (p) { if (p.timer) clearTimeout(p.timer); p.timer = null; p.q = []; }   // the snapshot already holds what was queued
    this.send(port, { type: "snapshot", events: panelEvents(this.state) });
    this.send(port, { type: "chrome", chrome: this.chrome_ });
    this.send(port, this.sessionsMessage());
  }

  // ── transcript ─────────────────────────────────────────────────────────────
  get panel(): PanelState { return this.state; }
  /** The diff card last shown for a proposal, if any. */
  proposal(key: string): ProposalEvent | undefined {
    const e = this.state.byId[proposalRowId(key)]?.e;
    return e?.kind === "proposal" ? e : undefined;
  }

  push(e: PanelEvent): void {
    this.state = applyPanelBatch(this.state, [e]);
    if (e.kind === "user" && this.title === "New session" && !this.meta.renamed) this.title = sessionTitle(e.text);   // a name the person chose is never replaced
    if (e.kind === "status") this.setChrome({ busy: e.state === "running" || e.state === "paused" || e.state === "stopping" });
    for (const [port, p] of this.ports) {
      p.q.push(e);
      if (e.kind === "status") this.flushPort(port);
      else p.timer ??= setTimeout(() => this.flushPort(port), this.d.batchMs ?? 33);
    }
    this.touch();
    if (e.kind === "user") this.broadcastSessions();
  }

  /** Sends everything queued, now. */
  flush(): void { for (const port of this.ports.keys()) this.flushPort(port); }

  private flushPort(port: HubPort): void {
    const p = this.ports.get(port);
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
    if (!p.q.length) return;
    const batch = coalesce(p.q); p.q = [];
    this.send(port, { type: "events", batch });
  }

  // ── chrome ─────────────────────────────────────────────────────────────────
  get chrome(): ChromeState { return this.chrome_; }
  setChrome(patch: Partial<ChromeState>): void {
    const changed = (Object.keys(patch) as (keyof ChromeState)[]).filter((k) => JSON.stringify(patch[k]) !== JSON.stringify(this.chrome_[k]));
    if (!changed.length) return;
    this.chrome_ = { ...this.chrome_, ...patch };
    this.broadcast({ type: "chrome", chrome: Object.fromEntries(changed.map((k) => [k, this.chrome_[k]])) as Partial<ChromeState> });
    if (changed.includes("busy")) this.broadcastSessions();
  }

  // ── sessions ───────────────────────────────────────────────────────────────
  get activeId(): string { return this.id; }
  get forge(): ForgeRef | undefined { return this.forge_; }
  set forge(f: ForgeRef | undefined) { this.forge_ = f; this.touch(); }

  /** The active session as a stored one (without the transcript), for its list entry and for writing it. */
  private current(): PersistedSession {
    const events = panelEvents(this.state);
    return { v: 1, id: this.id, title: this.title, createdAt: this.createdAt, updatedAt: this.lastTouched, forge: this.forge_, ...this.meta, ...sessionStats(events), events: [] };
  }

  /** Summaries for the sidebar: stored sessions plus the active one once it has content. The sidebar sorts, filters and groups them. */
  summaries(): SessionSummary[] {
    const stored = this.d.store.list().filter((s) => s.id !== this.id);
    const own: SessionSummary[] = this.state.order.length ? [summaryOf(this.current(), this.chrome_.busy)] : [];
    return [...own, ...stored];
  }

  /**
   * Rename, pin or archive a session, active or stored. Changing how it is listed is not activity: `updatedAt` stays.
   * An empty title gives the automatic one back. False when there is no such session.
   */
  async update(id: string, patch: SessionPatch): Promise<boolean> {
    if (id === this.id) {
      const next = patchSession({ title: this.title, preview: sessionStats(panelEvents(this.state)).preview, ...this.meta }, patch);
      this.title = next.title; this.meta = { pinned: !!next.pinned, archived: !!next.archived, renamed: !!next.renamed };
      this.dirty = true;
      this.persistTimer ??= setTimeout(() => this.persistNow(), this.d.persistMs ?? 1500);
      this.broadcastSessions();
      return true;
    }
    const s = await this.d.store.load(id);
    if (!s) return false;
    this.d.store.put(patchSession(s, patch));
    this.broadcastSessions();
    return true;
  }
  private sessionsMessage(): HostMessage { return { type: "sessions", items: this.summaries(), activeId: this.id }; }
  broadcastSessions(): void { this.broadcast(this.sessionsMessage()); }

  /** Writes the active session now, when it has content and changed. */
  persistNow(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (!this.dirty || !this.state.order.length) return;
    this.dirty = false;
    this.d.store.put({ ...this.current(), events: compactEvents(panelEvents(this.state)) });
  }
  private touch(): void {
    this.dirty = true;
    this.lastTouched = this.d.now();
    this.persistTimer ??= setTimeout(() => this.persistNow(), this.d.persistMs ?? 1500);
  }

  /** Starts an empty session. Refused while a turn runs: the run belongs to the active session. */
  newSession(): boolean {
    if (this.chrome_.busy) return false;
    this.persistNow();
    this.reset(this.d.newId(), "New session", this.d.now(), undefined, emptyPanel());
    return true;
  }

  async switchTo(id: string): Promise<boolean> {
    if (this.chrome_.busy || id === this.id) return false;
    const s = await this.d.store.load(id);
    if (!s) return false;
    this.persistNow();
    this.reset(s.id, s.title, s.createdAt, s.forge, applyPanelBatch(emptyPanel(), restoreEvents(s.events)), { pinned: !!s.pinned, archived: !!s.archived, renamed: !!s.renamed });
    return true;
  }

  /** Deletes a stored session. Deleting the active one starts a fresh one; refused while it runs. */
  remove(id: string): boolean {
    if (id !== this.id) { this.d.store.remove(id); this.broadcastSessions(); return true; }
    if (this.chrome_.busy) return false;
    this.d.store.remove(id);
    this.reset(this.d.newId(), "New session", this.d.now(), undefined, emptyPanel());
    return true;
  }

  private reset(id: string, title: string, createdAt: number, forge: ForgeRef | undefined, state: PanelState, meta = { pinned: false, archived: false, renamed: false }): void {
    for (const p of this.ports.values()) { if (p.timer) clearTimeout(p.timer); p.timer = null; p.q = []; }
    this.id = id; this.title = title; this.createdAt = createdAt; this.forge_ = forge; this.state = state; this.meta = meta; this.dirty = false;
    this.lastTouched = this.d.now();
    this.broadcast({ type: "snapshot", events: panelEvents(this.state) });
    this.broadcastSessions();
  }

  /** A message for every attached webview (the model list, for one). */
  broadcast(m: HostMessage): void { for (const port of this.ports.keys()) this.send(port, m); }
  /** A closed webview must not break the others. */
  private send(port: HubPort, m: HostMessage): void { try { port.post(m); } catch { /* the webview is gone; its dispose detaches it */ } }

  dispose(): void {
    this.persistNow();
    for (const p of this.ports.values()) if (p.timer) clearTimeout(p.timer);
    this.ports.clear();
  }
}
