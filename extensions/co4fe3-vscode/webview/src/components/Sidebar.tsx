import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import {
  SESSION_FILTERS, SESSION_GROUPS, SESSION_SORTS, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
  type ChromeState, type LayoutId, type SessionFilter, type SessionGroup, type SessionSort, type SessionSummary, type SidebarPrefs,
} from "@co4fe3/agent-core/panel";
import type { IconName } from "../format.js";
import { directionLabels, filterCounts, organizeSessions, searchTerms } from "../sessions.js";
import { Icon, Logo } from "./Icon.js";
import { usePopover } from "./menus.js";
import { SessionList, type ListActions } from "./SessionList.js";

/** The Agent | Editor switch. In the Agent view it sits at the top of the sidebar. */
export function LayoutPill({ layout, onLayout }: { layout: LayoutId; onLayout(l: LayoutId): void }) {
  return (
    <div className="pill" role="group" aria-label="View">
      <button type="button" className={layout === "agent" ? "on" : ""} aria-pressed={layout === "agent"} onClick={() => onLayout("agent")}>Agent</button>
      <button type="button" className={layout === "editor" ? "on" : ""} aria-pressed={layout === "editor"} onClick={() => onLayout("editor")}>Editor</button>
    </div>
  );
}

/** Shown in the Agent view's header while the sidebar is hidden. */
export function ShowSidebar({ onShow }: { onShow(): void }) {
  return <button type="button" className="icon-btn" onClick={onShow} aria-label="Show the sessions sidebar" title="Show the sessions sidebar"><Icon name="panelLeft" size={15} /></button>;
}

const FILTER_LABEL: Record<SessionFilter, string> = { all: "All sessions", pinned: "Pinned", running: "Running", edited: "With changes", archived: "Archived" };
const GROUP_LABEL: Record<SessionGroup, string> = { none: "No grouping", date: "Date", model: "Model", status: "Status" };
const SORT_LABEL: Record<SessionSort, string> = { updated: "Last activity", created: "Date created", name: "Name", turns: "Messages" };

interface Opt<T extends string> { id: T; label: string; count?: number }

/** A small dropdown of radio choices that opens below its button. */
function PickMenu<T extends string>({ icon, label, value, options, active, onPick, footer }: {
  icon: IconName; label: string; value: T; options: readonly Opt<T>[]; active: boolean; onPick(v: T): void; footer?: ReactNode;
}) {
  const { open, setOpen, ref } = usePopover();
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const cur = options.find((o) => o.id === value)?.label ?? value;
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    else if (wasOpen.current && (!document.activeElement || document.activeElement === document.body)) trigger.current?.focus();   // Escape on a menu item: do not lose the keyboard
    wasOpen.current = open;
  }, [open, ref]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const btns = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitemradio"]')];
    const at = btns.indexOf(document.activeElement as HTMLButtonElement);
    btns[(at + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length]?.focus();
  };
  return (
    <div className="side-menu" ref={ref}>
      <button ref={trigger} type="button" className={`side-tool${active ? " active" : ""}${open ? " open" : ""}`} aria-haspopup="menu" aria-expanded={open}
        aria-label={`${label}: ${cur}`} title={`${label}: ${cur}`} onClick={() => setOpen(!open)}>
        <Icon name={icon} size={13} /><span className="tool-label">{label}</span>{active && <i className="tool-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="side-pop" role="menu" aria-label={label} onKeyDown={onKey}>
          {options.map((o) => (
            <button key={o.id} type="button" role="menuitemradio" aria-checked={o.id === value} className={`menu-item${o.id === value ? " on" : ""}`}
              onClick={() => { onPick(o.id); setOpen(false); }}>
              <span className="menu-main"><span className="menu-title">{o.label}</span></span>
              {o.count !== undefined && <span className="menu-count">{o.count}</span>}
              {o.id === value && <Icon name="check" size={13} />}
            </button>
          ))}
          {footer}
        </div>
      )}
    </div>
  );
}

const clampWidth = (w: number): number => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));

/** The drag handle on the sidebar's right edge. Pointer drag, arrow keys (Shift for bigger steps), double-click resets. */
function Resizer({ width, onLive, onCommit }: { width: number; onLive(w: number): void; onCommit(w: number): void }) {
  const from = useRef<{ x: number; w: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const at = (e: PointerEvent<HTMLDivElement>): number => clampWidth((from.current?.w ?? width) + e.clientX - (from.current?.x ?? e.clientX));
  const onDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    from.current = { x: e.clientX, w: width };
    setDragging(true);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>): void => { if (from.current) onLive(at(e)); };
  const onUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (!from.current) return;
    const w = at(e);
    from.current = null; setDragging(false);
    onCommit(w);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowLeft") { e.preventDefault(); onCommit(clampWidth(width - step)); }
    else if (e.key === "ArrowRight") { e.preventDefault(); onCommit(clampWidth(width + step)); }
    else if (e.key === "Home") { e.preventDefault(); onCommit(SIDEBAR_MIN); }
    else if (e.key === "End") { e.preventDefault(); onCommit(SIDEBAR_MAX); }
  };
  return (
    <div className={`side-resizer${dragging ? " dragging" : ""}`} role="separator" aria-orientation="vertical" aria-label="Resize the sessions sidebar" tabIndex={0}
      aria-valuemin={SIDEBAR_MIN} aria-valuemax={SIDEBAR_MAX} aria-valuenow={width} title="Drag to resize. Double-click to reset."
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={() => onCommit(SIDEBAR_DEFAULT)} onKeyDown={onKey} />
  );
}

export interface SidebarProps {
  sessions: readonly SessionSummary[]; activeId: string; chrome: ChromeState; now: number;
  onNew(): void; onSwitch(id: string): void; onDelete(id: string): void; onRename(id: string, title: string): void;
  onPin(id: string, pinned: boolean): void; onArchive(id: string, archived: boolean): void;
  onPrefs(patch: Partial<SidebarPrefs>): void; onLayout(l: LayoutId): void;
}

export const Sidebar = memo(function Sidebar({ sessions, activeId, chrome, now, onNew, onSwitch, onDelete, onRename, onPin, onArchive, onPrefs, onLayout }: SidebarProps) {
  const prefs = chrome.sidebar;
  const [query, setQuery] = useState("");
  const [live, setLive] = useState<number | null>(null);                    // the width while a drag is in progress
  const root = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const terms = useMemo(() => searchTerms(query), [query]);
  const organized = useMemo(
    () => organizeSessions(sessions, { query, filter: prefs.filter, sort: prefs.sort, desc: prefs.desc, group: prefs.group }, now),
    [sessions, query, prefs.filter, prefs.sort, prefs.desc, prefs.group, now],
  );
  const counts = useMemo(() => filterCounts(sessions), [sessions]);
  const actions = useMemo<ListActions>(() => ({ open: onSwitch, remove: onDelete, rename: onRename, pin: onPin, archive: onArchive }), [onSwitch, onDelete, onRename, onPin, onArchive]);
  const toggleGroup = useCallback((id: string): void => {
    onPrefs({ collapsed: prefs.collapsed.includes(id) ? prefs.collapsed.filter((x) => x !== id) : [...prefs.collapsed, id] });
  }, [onPrefs, prefs.collapsed]);
  const clearSearch = useCallback((): void => { setQuery(""); search.current?.focus(); }, []);
  const showAll = useCallback((): void => { setQuery(""); onPrefs({ filter: "all" }); }, [onPrefs]);

  const width = live ?? prefs.width;
  const nonDefault = { filter: prefs.filter !== "all", group: prefs.group !== "none", sort: prefs.sort !== "updated" || !prefs.desc };
  const labels = directionLabels(prefs.sort);
  const count = organized.total === 0 ? "" : organized.shown === organized.total ? `${organized.total} session${organized.total === 1 ? "" : "s"}` : `${organized.shown} of ${organized.total}`;

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Escape" && query) { e.preventDefault(); e.stopPropagation(); setQuery(""); }
    else if (e.key === "ArrowDown" || (e.key === "Enter" && organized.shown > 0)) {
      e.preventDefault();
      root.current?.querySelector<HTMLElement>('.side-open[tabindex="0"]')?.focus();
      if (e.key === "Enter") root.current?.querySelector<HTMLElement>('.side-open[tabindex="0"]')?.click();
    }
  };

  return (
    <aside className="sidebar" ref={root} style={{ width }} aria-label="Sessions">
      <div className="side-top">
        <span className="brand"><Logo size={18} /><span className="brand-name">co4fe3</span></span>
        <LayoutPill layout="agent" onLayout={onLayout} />
      </div>
      <div className="side-newrow">
        <button type="button" className="side-new" onClick={onNew} disabled={chrome.busy} title={chrome.busy ? "Stop the running request first" : "Start a new session"}>
          <Icon name="plus" size={14} /><span>New session</span>
        </button>
        <button type="button" className="icon-btn" onClick={() => onPrefs({ hidden: true })} aria-label="Hide the sessions sidebar" title="Hide the sessions sidebar"><Icon name="panelLeft" size={15} /></button>
      </div>
      <div className="side-search">
        <Icon name="search" size={13} />
        <input ref={search} type="text" value={query} placeholder="Search sessions" aria-label="Search sessions" spellCheck={false} autoComplete="off"
          onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} />
        {query && <button type="button" className="side-clear" onClick={clearSearch} aria-label="Clear the search" title="Clear (Esc)"><Icon name="x" size={12} /></button>}
      </div>
      <div className="side-tools">
        <PickMenu icon="filter" label="Filter" value={prefs.filter} active={nonDefault.filter} onPick={(filter) => onPrefs({ filter })}
          options={SESSION_FILTERS.map((id) => ({ id, label: FILTER_LABEL[id], count: counts[id] }))} />
        <PickMenu icon="group" label="Group" value={prefs.group} active={nonDefault.group} onPick={(group) => onPrefs({ group })}
          options={SESSION_GROUPS.map((id) => ({ id, label: GROUP_LABEL[id] }))} />
        <PickMenu icon="sort" label="Sort" value={prefs.sort} active={nonDefault.sort} onPick={(sort) => onPrefs({ sort })}
          options={SESSION_SORTS.map((id) => ({ id, label: SORT_LABEL[id] }))}
          footer={(
            <>
              <div className="menu-section-title">Order</div>
              {([true, false] as const).map((desc) => (
                <button key={String(desc)} type="button" role="menuitemradio" aria-checked={prefs.desc === desc} className={`menu-item${prefs.desc === desc ? " on" : ""}`} onClick={() => onPrefs({ desc })}>
                  <span className="menu-main"><span className="menu-title">{desc ? labels.desc : labels.asc}</span></span>
                  {prefs.desc === desc && <Icon name="check" size={13} />}
                </button>
              ))}
            </>
          )} />
      </div>
      <SessionList organized={organized} terms={terms} query={query} filter={prefs.filter} hasAny={sessions.length > 0} activeId={activeId} busy={chrome.busy} now={now}
        collapsed={prefs.collapsed} actions={actions} onToggleGroup={toggleGroup} onClearSearch={clearSearch} onShowAll={showAll} />
      {count && <div className="side-count" aria-live="polite">{count}</div>}
      <div className="side-foot">
        <span className={`dot ${chrome.trueforge}`} aria-hidden="true" />
        <span>{chrome.trueforge === "connected" ? "TrueForge connected" : chrome.trueforge === "down" ? "TrueForge not reachable" : "Waiting for TrueForge"}</span>
      </div>
      <Resizer width={width} onLive={setLive} onCommit={(w) => { setLive(null); onPrefs({ width: w }); }} />
    </aside>
  );
});
