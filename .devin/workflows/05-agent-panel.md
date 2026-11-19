---
description: The agent panel - webview with strict CSP, the PanelEvent protocol and pure reducer, batched streaming, tool and diff cards, approvals answered from the panel, instant Stop, and the TrueForge session link
argument-hint: ""
---

# 05 Agent panel (A2 tool loop, A3 streaming + cancel)

Goal: type a request → a turn streams into the panel → tool cards appear → `propose_edit` pauses → per-hunk review
(panel card and diff editor) → the turn resumes → Stop at any moment shows "Stopped" within 100 ms and leaves the
workspace consistent.

## 1. The protocol (`agent-core/src/panel/events.ts`). The webview never sees SDK types.

```ts
export type PanelEvent =
  | { kind: "user"; turnId: string; text: string }
  | { kind: "text"; id: string; threadId: string; text: string; reasoning: string }            // snapshot of one model.message (same id replaces)
  | { kind: "tool"; id: string; threadId: string; name: string; args: string; state: "running" | "ok" | "error"; result?: string; ms?: number }
  | { kind: "member"; threadId: string; title: string; role?: Role; state: "running" | "ok" | "error" }     // reducer MERGES member rows
  | { kind: "message"; id: string; from: string; to: string; text: string }                     // brief (to-<thread>) / report (from-<thread>)
  | { kind: "pack"; pack: ContextPack }
  | { kind: "instructions"; inline: string[]; onDemand: number }
  | { kind: "proposal"; key: string; path: string; why: string; by: string; adds: number; removes: number; hunks: HunkView[]; verdict: Record<string, "pending" | "accepted" | "rejected">; applied?: { checkpointId: string } }
  | { kind: "command"; id: string; command: string; state: "asking" | "running" | "done" | "denied"; output?: string; exit?: number | null }
  | { kind: "board"; entries: BoardEntry[] }
  | { kind: "marker"; id: string; text: string }                                                // "context compacted", "switched to …"
  | { kind: "model"; note: Note }                                                               // from runWithFallback (rule 70)
  | { kind: "latency"; line: string }
  | { kind: "status"; state: "running" | "paused" | "stopping" | "done" | "cancelled" | "error"; message?: string; sessionUrl?: string };

export type UiCommand =
  | { type: "ready" } | { type: "send"; text: string } | { type: "stop" }
  | { type: "decide"; key: string; hunkId: string; verdict: "accepted" | "rejected" } | { type: "decideAll"; key: string; verdict: "accepted" | "rejected" }
  | { type: "openDiff"; key: string } | { type: "command"; id: string; verdict: "allow" | "deny" }
  | { type: "undo"; checkpointId: string } | { type: "revertTurn"; turnId: string }
  | { type: "openSession" } | { type: "pickModel" } | { type: "complete"; kind: "@" | "/"; prefix: string };
```

`agent-core/src/forge/fromForge.ts` maps TrueForge events to PanelEvents. It lives in `forge/`, not `panel/`, so the
webview bundle never pulls in the SDK. It is pure and unit-tested on recorded spike events:

| TrueForge event | Becomes |
|---|---|
| `model.message` (after merging) | `text`, plus one `tool` (running) per tool call |
| `tool.response` | `tool` (ok/error, with result) |
| `thread.created` / `thread.done` | `member`, plus a brief/report `message` (rule 50) |
| `thread.context_compaction_*` | `marker` |
| `turn.update` / `turn.done` | `status` |

## 2. Reducer (`agent-core/src/panel/reducer.ts`). Pure; the webview's only state.

```ts
export interface PanelState { order: Row[]; byId: Record<string, Row>; status: PanelEvent & { kind: "status" } | null; board: BoardEntry[] }
export type Row = { k: "user" | "text" | "tool" | "member" | "message" | "pack" | "proposal" | "command" | "marker" | "model" | "latency" | "instructions"; id: string; e: PanelEvent };

/** Same (kind,id) → replace in place; new → append. Never mutates `s`. Replaying a batch twice gives the same state. */
export function applyPanelEvent(s: PanelState, e: PanelEvent): PanelState {
  if (e.kind === "status") return { ...s, status: e };
  if (e.kind === "board") return { ...s, board: e.entries };
  const id = rowId(e);                                     // e.g. "tool:<id>", "proposal:<key>", "member:<threadId>"
  const prev = s.byId[id];
  const merged = prev && e.kind === "member" ? ({ ...prev.e, ...e } as PanelEvent) : e;   // member rows merge (keep role/title); all else replaces
  const row: Row = { k: e.kind, id, e: merged };
  return prev ? { ...s, byId: { ...s.byId, [id]: row } } : { ...s, order: [...s.order, row], byId: { ...s.byId, [id]: row } };
}
```

Tests: replay idempotence; member brief/report order; a proposal update replaces its card; `coalesce` keeps the last
snapshot per row id and the first-seen order.

## 3. The bridge (`extensions/…/src/panel/bridge.ts`): 33 ms batches, snapshots only

```ts
export class Bridge {
  private q: PanelEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private post: (batch: PanelEvent[]) => Thenable<boolean>, private everyMs = 33) {}
  push(e: PanelEvent): void { this.q.push(e); this.timer ??= setTimeout(() => this.flush(), this.everyMs); }
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.q.length) return;
    const batch = coalesce(this.q); this.q = [];
    void this.post(batch);
  }
}
```

Status changes (`stopping`, `cancelled`, `done`) call `flush()` at once, so they skip the 33 ms wait.

## 4. The view (`extensions/…/src/panel/panelView.ts`)

```ts
export class PanelView implements vscode.WebviewViewProvider {
  static readonly id = "co4fe3.panel";
  resolveWebviewView(view: vscode.WebviewView): void {
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = randomBytes(16).toString("base64");
    const js = view.webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.js")), css = view.webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.css"));
    view.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.webview.cspSource} data:; style-src ${view.webview.cspSource}; font-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${css}"></head><body><div id="root"></div><script nonce="${nonce}" src="${js}"></script></body></html>`;
    this.bridge = new Bridge((b) => view.webview.postMessage({ type: "events", batch: b }));
    view.webview.onDidReceiveMessage((m: UiCommand) => this.onCommand(m));   // validate `m.type` with a switch + assertNever
  }
}
// registration: vscode.window.registerWebviewViewProvider(PanelView.id, view, { webviewOptions: { retainContextWhenHidden: true } })
```

**Model text is rendered as React elements, never as HTML.** No `dangerouslySetInnerHTML` anywhere. The tiny
markdown renderer (`webview/src/md.tsx`) handles paragraphs, `code`, fenced blocks and lists, nothing more.

## 5. One agent turn (`extensions/…/src/panel/agentTurn.ts`)

```ts
async function send(text: string): Promise<void> {
  if (this.running) return;                                     // Send is Stop while running (rule 20, trap 3)
  const ac = new AbortController(); this.running = ac;
  const turnKey = `t${Date.now().toString(36)}`;
  this.bridge.push({ kind: "user", turnId: turnKey, text });
  const pack = await this.context.packFor(text);                // rule 40; ≤ 250 ms with a warm index
  this.bridge.push({ kind: "pack", pack });
  const sel = selectInline(await this.instructions(), pack.items.map((i) => i.path));
  this.bridge.push({ kind: "instructions", inline: sel.inline.map((i) => i.name), onDemand: sel.onDemand.length });
  const session = await this.sessions.agent(renderInstructions(LEAD, sel)); // inline-spec session, model from the router
  this.bridge.push({ kind: "status", state: "running", sessionUrl: sessionUrl(this.cfg.trueforgeUrl, session.id) });
  const out = await this.router.agent(session, `${expandWorkflow(this.set, text).text}\n\n${renderPack(pack)}`, {
    onEvent: (e, index) => { for (const pe of fromForge(e, index)) this.bridge.push(pe); this.watch(e, ac); },
    onPause: makeOnPause(this.pauseDeps(turnKey)),
  }, ac.signal);
  this.review.closeTurn(turnKey);                               // drops undecided proposals (rule 30)
  this.bridge.push({ kind: "status", state: out.status === "done" ? "done" : out.status, message: out.status === "error" ? out.message : undefined });
  this.bridge.flush(); this.running = null;
}
stop(): void { this.bridge.push({ kind: "status", state: "stopping" }); this.bridge.flush(); this.running?.abort(); }   // UI first, then the network
```

## 6. Answering pauses (`extensions/…/src/panel/pause.ts`)

```ts
export function makeOnPause(d: PauseDeps): TurnHooks["onPause"] {
  return async (pending, _index, signal) => Promise.all(pending.map(async (p): Promise<TrueForgeApi.TurnUserEventMessage> => {
    if (p.kind === "response") return reply(p, "This client does not support client-side tools.");
    const tool = toolNameOf(p.call, d.serverName);               // our server only; preloaded → toolInfo.type === "mcp"
    const member = d.crew.member(p.threadId);                    // undefined for the lead ("main")
    if (!tool) return deny(p, "Unknown tool.");
    if (member && !memberMayCall(member.role, tool)) return deny(p, `${member.role} members do not call ${tool}. Report what should change; the lead will do it.`);
    if (tool === "propose_edit") return reviewEdit(d, p, member?.title ?? "lead", signal);
    if (tool === "run_command") return approveCommand(d, p, signal);   // policy check, then a panel card with Allow / Deny
    return allow(p);
  }));
}

async function reviewEdit(d: PauseDeps, p: PendingCall, by: string, signal: AbortSignal) {
  const v = ProposeEdit.safeParse(safeJson(p.call?.function.arguments));
  if (!v.success) return deny(p, `Invalid propose_edit arguments: ${v.error.issues.map((i) => i.message).join("; ")}`);
  let rel: string;
  try { rel = jail(d.host.root, v.data.path); } catch (e) { return deny(p, (e as Error).message); }
  const before = await d.host.readText(rel);
  const plan = planEdit(before, (v.data.edits ?? []).map((x) => ({ oldString: x.old_string, newString: x.new_string })), v.data.content);
  if (!plan.ok) return deny(p, plan.error);                      // the model learns now; the user never sees a broken edit
  const proposal: Proposal = { key: proposalKey(rel, v.data), turnId: d.turnKey, threadId: p.threadId, toolCallId: p.toolCallId, by, path: rel, why: v.data.why, before, after: plan.after, hunks: toHunks(before ?? "", plan.after), verdict: {} };
  const decision = await d.review.review(proposal, signal);      // panel card + diff editor; resolves when every hunk is decided
  if (!decision.accepted.length) return deny(p, `The user rejected all ${proposal.hunks.length} hunks for ${rel}. Do not propose them again unless asked.`);
  d.sideEffect();                                                // from here a fallback retry is not allowed (rule 70)
  return allow(p);                                               // TrueForge now runs propose_edit → handler writes the accepted hunks
}
```

## Exit check

- Unit: `reducer`, `coalesce`, `fromForge` (on the spike's recorded events) green.
- Integration: `cancel.test.ts` (Stop mid-stream → `cancelled` < 1 s; Stop during a pending review → nothing
  written, the proposal is dropped) and `approval.test.ts` green.
- Extension Development Host on minipkg with the real model, request "rename get_verbose_flag to get_flag
  everywhere": tool cards stream, two proposals pause for review, accept one and reject the other → the session ends
  with the rejection reported. Press Stop during a second run → "Stopped" appears instantly; `git status` shows
  only what was accepted.
- Commit: `panel: streaming agent panel with review cards and instant stop`
