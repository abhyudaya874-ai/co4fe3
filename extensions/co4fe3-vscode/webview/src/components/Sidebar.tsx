import { memo } from "react";
import { relativeAge, type ChromeState, type LayoutId, type SessionSummary } from "@co4fe3/agent-core/panel";
import { Icon, Logo, Spinner } from "./Icon.js";

/** The Agent | Editor switch. In the Agent view it sits at the top of the sidebar. */
export function LayoutPill({ layout, onLayout }: { layout: LayoutId; onLayout(l: LayoutId): void }) {
  return (
    <div className="pill" role="group" aria-label="View">
      <button type="button" className={layout === "agent" ? "on" : ""} aria-pressed={layout === "agent"} onClick={() => onLayout("agent")}>Agent</button>
      <button type="button" className={layout === "editor" ? "on" : ""} aria-pressed={layout === "editor"} onClick={() => onLayout("editor")}>Editor</button>
    </div>
  );
}

export const Sidebar = memo(function Sidebar({ sessions, activeId, chrome, now, onNew, onSwitch, onDelete, onLayout }: {
  sessions: readonly SessionSummary[]; activeId: string; chrome: ChromeState; now: number;
  onNew(): void; onSwitch(id: string): void; onDelete(id: string): void; onLayout(l: LayoutId): void;
}) {
  return (
    <aside className="sidebar" aria-label="Sessions">
      <div className="side-top">
        <span className="brand"><Logo size={18} /><span>co4fe3</span></span>
        <LayoutPill layout="agent" onLayout={onLayout} />
      </div>
      <button type="button" className="side-new" onClick={onNew} disabled={chrome.busy} title={chrome.busy ? "Stop the running request first" : "Start a new session"}>
        <Icon name="plus" size={14} /><span>New session</span>
      </button>
      <div className="side-label"><span>Sessions</span><Icon name="chevronRight" size={11} /><span className="side-sub">Recent</span></div>
      <nav className="side-list">
        {sessions.length === 0 && <div className="side-empty">Your sessions appear here.</div>}
        {sessions.map((s) => {
          const active = s.id === activeId;
          return (
            <div key={s.id} className={`side-item${active ? " on" : ""}`}>
              <button type="button" className="side-open" onClick={() => onSwitch(s.id)} disabled={chrome.busy && !active} aria-current={active ? "true" : undefined} title={s.title}>
                <span className="side-title">{s.title}</span>
                <span className="side-age">{s.running ? <Spinner size={11} /> : relativeAge(s.updatedAt, now)}</span>
              </button>
              <button type="button" className="side-del" onClick={() => onDelete(s.id)} disabled={s.running} aria-label={`Delete ${s.title}`} title="Delete this session"><Icon name="trash" size={12} /></button>
            </div>
          );
        })}
      </nav>
      <div className="side-foot">
        <span className={`dot ${chrome.trueforge}`} aria-hidden="true" />
        <span>{chrome.trueforge === "connected" ? "TrueForge connected" : chrome.trueforge === "down" ? "TrueForge not reachable" : "Waiting for TrueForge"}</span>
      </div>
    </aside>
  );
});
