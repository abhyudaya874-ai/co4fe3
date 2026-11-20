import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { applyPanelBatch, emptyChrome, emptyPanel, type ChromeState, type HostMessage, type LayoutId, type ModelRow, type PanelEvent, type PanelState, type SelectionRef, type SessionSummary, type UiCommand, type UiMode } from "@co4fe3/agent-core/panel";
import { ActionsContext, type Actions } from "./actions.js";
import { Transcript } from "./components/Transcript.js";
import { Composer } from "./components/Composer.js";
import { Sidebar, LayoutPill } from "./components/Sidebar.js";
import { Empty } from "./components/Empty.js";
import { Icon } from "./components/Icon.js";
import { ReviewBar } from "./components/ReviewBar.js";
import { pendingReview } from "./format.js";

export type Post = (m: UiCommand) => void;
export type Surface = "agent" | "dock";

/** A batch extends the transcript; a reset replaces it (first paint, a session switch). */
type Act = { t: "batch"; events: readonly PanelEvent[] } | { t: "reset"; events: readonly PanelEvent[] };
const reduce = (s: PanelState, a: Act): PanelState => (a.t === "reset" ? applyPanelBatch(emptyPanel(), a.events) : applyPanelBatch(s, a.events));

const NEAR_BOTTOM_PX = 80;

export function App({ post, surface }: { post: Post; surface: Surface }) {
  const [s, dispatch] = useReducer(reduce, undefined, emptyPanel);
  const [chrome, setChrome] = useState<ChromeState>(emptyChrome);
  const [sessions, setSessions] = useState<{ items: SessionSummary[]; activeId: string }>({ items: [], activeId: "" });
  const [models, setModels] = useState<{ rows: ModelRow[]; auto: boolean }>({ rows: [], auto: true });
  const [completions, setCompletions] = useState<{ kind: "@" | "/"; items: string[] } | null>(null);
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [resets, setResets] = useState(0);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const m = ev.data as HostMessage | undefined;
      if (!m || typeof m !== "object") return;
      switch (m.type) {
        case "events": dispatch({ t: "batch", events: m.batch }); break;           // one pass, one React commit (rule 60 lever 10)
        case "snapshot": dispatch({ t: "reset", events: m.events }); setResets((n) => n + 1); break;
        case "chrome": setChrome((c) => ({ ...c, ...m.chrome })); break;
        case "sessions": setSessions({ items: m.items, activeId: m.activeId }); break;
        case "models": setModels({ rows: m.rows, auto: m.auto }); break;
        case "completions": setCompletions({ kind: m.kind, items: m.items }); break;
      }
    };
    window.addEventListener("message", onMessage);
    post({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, [post]);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);   // "5 minutes ago" keeps counting

  const actions = useMemo<Actions>(() => ({
    decide: (key, hunkId, verdict) => post({ type: "decide", key, hunkId, verdict }),
    decideAll: (key, verdict) => post({ type: "decideAll", key, verdict }),
    openDiff: (key) => post({ type: "openDiff", key }),
    openFile: (path, line) => post({ type: "openFile", path, ...(line ? { line } : {}) }),
    command: (id, verdict) => post({ type: "command", id, verdict }),
    undo: (checkpointId) => post({ type: "undo", checkpointId }),
  }), [post]);

  // Stay at the bottom while text streams, unless the person scrolled up to read; then offer a jump button.
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [away, setAway] = useState(false);
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    stuck.current = near;
    setAway(!near && el.scrollHeight > el.clientHeight + 160);
  }, []);
  const toBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    stuck.current = true; setAway(false);
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);
  useLayoutEffect(() => { if (stuck.current) { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; } }, [s]);
  useLayoutEffect(() => { toBottom(); }, [resets, toBottom]);

  const empty = s.order.length === 0;
  const review = useMemo(() => pendingReview(s.order.map((r) => r.e)), [s]);
  const onSend = useCallback((text: string, attach?: SelectionRef) => {
    stuck.current = true;
    post({ type: "send", text, ...(attach ? { attach } : {}) });
  }, [post]);
  const clearCompletions = useCallback(() => setCompletions(null), []);
  const onLayout = useCallback((layout: LayoutId) => post({ type: "setLayout", layout }), [post]);

  return (
    <ActionsContext.Provider value={actions}>
      <div className={`app ${surface}`}>
        {surface === "agent" && (
          <Sidebar sessions={sessions.items} activeId={sessions.activeId} chrome={chrome} now={now}
            onNew={() => post({ type: "newSession" })} onSwitch={(id) => post({ type: "switchSession", id })} onDelete={(id) => post({ type: "deleteSession", id })} onLayout={onLayout} />
        )}
        <main className="main">
          {surface === "dock" && (
            <header className="dock-top">
              <span className="dock-title">{sessions.items.find((x) => x.id === sessions.activeId)?.title ?? "New session"}</span>
              <LayoutPill layout="editor" onLayout={onLayout} />
            </header>
          )}
          <div className="scroll" ref={scroller} onScroll={onScroll}>
            <div className="column">
              {empty ? <Empty surface={surface} folder={chrome.folder} onPick={(t) => setDraft(t)} /> : <Transcript s={s} busy={chrome.busy} />}
            </div>
          </div>
          {away && <button type="button" className="jump" onClick={() => toBottom(true)} aria-label="Scroll to the latest message" title="Scroll to the latest message"><Icon name="arrowDown" size={15} /></button>}
          <div className="bottom">
            <div className="column">
              <ReviewBar {...review} />
              <Composer chrome={chrome} models={models} draft={draft} setDraft={setDraft} completions={completions} clearCompletions={clearCompletions}
                onSend={onSend} onStop={() => post({ type: "stop" })} onFocus={() => post({ type: "focus" })}
                onComplete={(kind, prefix) => post({ type: "complete", kind, prefix })}
                onMode={(mode: UiMode) => post({ type: "setMode", mode })} onModel={(name) => post({ type: "setModel", name })} onModelsOpen={() => post({ type: "models" })} />
              <div className="foot-chips">
                <span className="foot-chip" title="Runs through TrueForge on this machine"><Icon name="bolt" size={12} />Local</span>
                {chrome.folder && <span className="foot-chip" title="The workspace folder"><Icon name="folder" size={12} />{chrome.folder}</span>}
                <button type="button" className={`foot-chip${chrome.sessionUrl ? " link" : ""}`} aria-disabled={!chrome.sessionUrl} onClick={() => { if (chrome.sessionUrl) post({ type: "openSession" }); }}
                  title={chrome.sessionUrl ? "Open this conversation in TrueForge" : chrome.trueforge === "connected" ? "TrueForge is connected" : "TrueForge is not connected yet"}>
                  <span className={`dot ${chrome.trueforge}`} aria-hidden="true" />TrueForge
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </ActionsContext.Provider>
  );
}
