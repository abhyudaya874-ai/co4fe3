import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { relativeAge, type SessionFilter, type SessionSummary } from "@co4fe3/agent-core/panel";
import { matchRanges, resultLine, sessionDetail, type Organized } from "../sessions.js";
import type { IconName } from "../format.js";
import { Icon, Spinner } from "./Icon.js";
import { RenameInput } from "./Rename.js";

/** What a row can do. Each posts one command to the host, which saves it and sends the new list back. */
export interface ListActions {
  open(id: string): void;
  remove(id: string): void;
  rename(id: string, title: string): void;
  pin(id: string, pinned: boolean): void;
  archive(id: string, archived: boolean): void;
}

/** `text` with the search words highlighted. */
export function Marked({ text, terms }: { text: string; terms: readonly string[] }) {
  const ranges = terms.length ? matchRanges(text, terms) : [];
  if (!ranges.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a > at) out.push(text.slice(at, a));
    out.push(<mark key={i}>{text.slice(a, b)}</mark>);
    at = b;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

type RowMode = "rename" | "confirm";
interface RowProps {
  s: SessionSummary; active: boolean; busy: boolean; now: number; terms: readonly string[]; mode: RowMode | null; tab: boolean; actions: ListActions;
  onMode(id: string, mode: RowMode | null): void; onMenu(id: string, x: number, y: number): void; onCursor(id: string): void;
}

const Row = memo(function Row({ s, active, busy, now, terms, mode, tab, actions, onMode, onMenu, onCursor }: RowProps) {
  if (mode === "rename") {
    const commit = (text: string): void => {
      onMode(s.id, null);
      const t = text.trim();
      if (t === s.title || (!t && !s.renamed)) return;                 // nothing changed; an empty name only matters when it restores the automatic one
      actions.rename(s.id, t);
    };
    return (
      <div className="side-item editing" data-sid={s.id}>
        <RenameInput value={s.title} placeholder="Name (empty restores the automatic one)" label={`Rename ${s.title}`} onCommit={commit} onCancel={() => onMode(s.id, null)} />
      </div>
    );
  }
  if (mode === "confirm") {
    return (
      <div className="side-item confirm" data-sid={s.id} role="alertdialog" aria-label={`Delete ${s.title}?`}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onMode(s.id, null); } }}>
        <span className="confirm-text" title={s.title}>Delete “{s.title}”?</span>
        <button type="button" className="confirm-yes" autoFocus onClick={() => { onMode(s.id, null); actions.remove(s.id); }}>Delete</button>
        <button type="button" className="confirm-no" onClick={() => onMode(s.id, null)}>Cancel</button>
      </div>
    );
  }
  const blocked = busy && !active;                                      // another session cannot be opened while a request runs
  const sub = resultLine(s, terms);
  return (
    <div className={`side-item${active ? " on" : ""}${s.pinned ? " pinned" : ""}${s.archived ? " archived" : ""}`} data-sid={s.id}
      onContextMenu={(e) => { e.preventDefault(); onMenu(s.id, e.clientX, e.clientY); }}>
      <button type="button" className="side-open" tabIndex={tab ? 0 : -1} aria-current={active ? "true" : undefined} aria-disabled={blocked || undefined}
        title={`${s.title}\n${sessionDetail(s)}${blocked ? "\nStop the running request to open another session" : ""}`}
        onClick={() => { if (!blocked) actions.open(s.id); }} onDoubleClick={() => onMode(s.id, "rename")} onFocus={() => onCursor(s.id)}>
        {s.pinned && <Icon name="pin" size={11} className="side-pin" />}
        <span className="side-main">
          <span className="side-title"><Marked text={s.title} terms={terms} /></span>
          {sub && <span className="side-line2"><Marked text={sub} terms={terms} /></span>}
        </span>
        <span className="side-age">{s.running ? <Spinner size={11} /> : relativeAge(s.updatedAt, now)}</span>
      </button>
      <span className="side-acts">
        <button type="button" className={`side-act${s.pinned ? " on" : ""}`} tabIndex={-1} aria-pressed={s.pinned} aria-label={`${s.pinned ? "Unpin" : "Pin"} ${s.title}`}
          title={s.pinned ? "Unpin" : "Pin to the top"} onClick={() => actions.pin(s.id, !s.pinned)}><Icon name="pin" size={13} /></button>
        <button type="button" className="side-act" tabIndex={-1} aria-label={`Rename ${s.title}`} title="Rename (F2)" onClick={() => onMode(s.id, "rename")}><Icon name="edit" size={13} /></button>
        <button type="button" className="side-act" tabIndex={-1} aria-label={`More actions for ${s.title}`} aria-haspopup="menu" title="More"
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onMenu(s.id, r.right - 4, r.bottom + 2); }}><Icon name="dots" size={13} /></button>
      </span>
    </div>
  );
});

const MENU_W = 188, MENU_H = 138;
interface MenuItem { label: string; hint?: string; icon: IconName; danger?: boolean; disabled?: boolean; why?: string; run(): void }

/** The right-click menu of a row. Opens at the pointer (or under the "more" button), closes on Escape, an outside press, or a choice. */
function ContextMenu({ s, x, y, actions, onMode, onClose }: { s: SessionSummary; x: number; y: number; actions: ListActions; onMode: RowProps["onMode"]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    const down = (e: MouseEvent): void => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: globalThis.KeyboardEvent): void => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", down, true); document.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose); window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  const items: MenuItem[] = [
    { label: "Rename", hint: "F2", icon: "edit", run: () => onMode(s.id, "rename") },
    { label: s.pinned ? "Unpin" : "Pin to the top", icon: "pin", run: () => actions.pin(s.id, !s.pinned) },
    { label: s.archived ? "Unarchive" : "Archive", icon: "archive", run: () => actions.archive(s.id, !s.archived) },
    { label: "Delete…", hint: "Del", icon: "trash", danger: true, disabled: s.running, why: "Stop the running request first", run: () => onMode(s.id, "confirm") },
  ];
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const btns = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const at = btns.indexOf(document.activeElement as HTMLButtonElement);
    btns[(at + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length]?.focus();
  };
  const left = Math.max(4, Math.min(x, window.innerWidth - MENU_W - 4)), top = Math.max(4, Math.min(y, window.innerHeight - MENU_H - 4));
  return (
    <div ref={ref} className="ctx-menu" role="menu" aria-label={`Actions for ${s.title}`} style={{ left, top, width: MENU_W }} onKeyDown={onKey}>
      {items.map((it) => (
        <button key={it.label} type="button" role="menuitem" className={`ctx-item${it.danger ? " danger" : ""}`} disabled={it.disabled} title={it.disabled ? it.why : undefined}
          onClick={() => { onClose(); it.run(); }}>
          <Icon name={it.icon} size={13} /><span className="ctx-label">{it.label}</span>{it.hint && <kbd>{it.hint}</kbd>}
        </button>
      ))}
    </div>
  );
}

const FILTER_NONE: Record<SessionFilter, string> = {
  all: "", pinned: "No pinned sessions. Pin one with the pin button on a row.", running: "Nothing is running.", edited: "No session has changed files yet.", archived: "No archived sessions.",
};

export interface SessionListProps {
  organized: Organized; terms: readonly string[]; query: string; filter: SessionFilter; hasAny: boolean;
  activeId: string; busy: boolean; now: number; collapsed: readonly string[]; actions: ListActions;
  onToggleGroup(id: string): void; onClearSearch(): void; onShowAll(): void;
}

/** The grouped, searchable list of sessions. Arrow keys move between rows, F2 renames, Delete asks to delete, the menu key opens the row's menu. */
export function SessionList({ organized, terms, query, filter, hasAny, activeId, busy, now, collapsed, actions, onToggleGroup, onClearSearch, onShowAll }: SessionListProps) {
  const listRef = useRef<HTMLElement>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; mode: RowMode } | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const refocus = useRef<string | null>(null);

  const searching = terms.length > 0;                                   // a search shows every match, even inside a group that was folded
  const shut = new Set(searching ? [] : collapsed);
  const visible = organized.groups.flatMap((g) => (shut.has(g.id) ? [] : g.items));
  const tabId = [cursor, activeId].find((id) => id && visible.some((s) => s.id === id)) ?? visible[0]?.id;

  const focusRow = useCallback((id: string): void => {
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-sid="${CSS.escape(id)}"] .side-open`)?.focus());
  }, []);
  const onMode = useCallback((id: string, mode: RowMode | null): void => {
    setEdit(mode ? { id, mode } : null);
    if (!mode) focusRow(id);
  }, [focusRow]);
  const onMenu = useCallback((id: string, x: number, y: number): void => { refocus.current = id; setMenu({ id, x, y }); }, []);
  const closeMenu = useCallback((): void => setMenu(null), []);
  useEffect(() => { if (!menu && refocus.current) { const id = refocus.current; refocus.current = null; if (!edit) focusRow(id); } }, [menu, edit, focusRow]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT") return;
    const row = target.closest<HTMLElement>(".side-open, .side-group");
    if (!row) return;
    const sid = target.closest<HTMLElement>("[data-sid]")?.dataset.sid;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>(".side-open, .side-group") ?? [])];
    const at = rows.indexOf(row);
    const go = (i: number): void => { e.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, i))]?.focus(); };
    const isGroup = row.classList.contains("side-group"), gid = row.dataset.gid;
    switch (e.key) {
      case "ArrowDown": go(at + 1); break;
      case "ArrowUp": go(at - 1); break;
      case "Home": go(0); break;
      case "End": go(rows.length - 1); break;
      case "ArrowRight": if (isGroup && gid && row.getAttribute("aria-expanded") === "false") { e.preventDefault(); onToggleGroup(gid); } break;
      case "ArrowLeft":
        if (isGroup && gid && row.getAttribute("aria-expanded") === "true") { e.preventDefault(); onToggleGroup(gid); }
        else if (!isGroup) { const head = rows.slice(0, at).reverse().find((r) => r.classList.contains("side-group")); if (head) go(rows.indexOf(head)); }
        break;
      case "F2": if (sid) { e.preventDefault(); onMode(sid, "rename"); } break;
      case "Delete": if (sid) { e.preventDefault(); const s = organized.groups.flatMap((g) => g.items).find((x) => x.id === sid); if (s && !s.running) onMode(sid, "confirm"); } break;
      case "ContextMenu": if (sid) { e.preventDefault(); const r = row.getBoundingClientRect(); onMenu(sid, r.left + 24, r.bottom); } break;
      case "F10": if (sid && e.shiftKey) { e.preventDefault(); const r = row.getBoundingClientRect(); onMenu(sid, r.left + 24, r.bottom); } break;
    }
  };

  const menuFor = menu ? organized.groups.flatMap((g) => g.items).find((s) => s.id === menu.id) : undefined;
  return (
    <nav className="side-list" ref={listRef} aria-label="Session list" onKeyDown={onKeyDown}>
      {organized.groups.length === 0 && (
        <div className="side-empty">
          {!hasAny ? <><strong>No sessions yet.</strong><span>Your conversations appear here.</span></>
            : searching ? <><span>No session matches “{query.trim()}”.</span><button type="button" className="side-link" onClick={onClearSearch}>Clear search</button></>
            : <><span>{FILTER_NONE[filter]}</span><button type="button" className="side-link" onClick={onShowAll}>Show all sessions</button></>}
        </div>
      )}
      {organized.groups.map((g) => {
        const folded = shut.has(g.id);
        return (
          <section key={g.id} className="side-group-wrap" aria-label={g.title || "Sessions"}>
            {g.title && (
              <button type="button" className="side-group" data-gid={g.id} tabIndex={-1} aria-expanded={!folded} onClick={() => onToggleGroup(g.id)}>
                <Icon name={folded ? "chevronRight" : "chevronDown"} size={11} /><span className="side-group-title">{g.title}</span><span className="side-group-count">{g.items.length}</span>
              </button>
            )}
            {!folded && g.items.map((s) => (
              <Row key={s.id} s={s} active={s.id === activeId} busy={busy} now={now} terms={terms} mode={edit?.id === s.id ? edit.mode : null} tab={s.id === tabId}
                actions={actions} onMode={onMode} onMenu={onMenu} onCursor={setCursor} />
            ))}
          </section>
        );
      })}
      {menu && menuFor && <ContextMenu s={menuFor} x={menu.x} y={menu.y} actions={actions} onMode={onMode} onClose={closeMenu} />}
    </nav>
  );
}
