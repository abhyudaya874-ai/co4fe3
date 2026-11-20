import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { UI_MODES, type ModelRow, type UiMode } from "@co4fe3/agent-core/panel";
import { modelSections, seconds, speedBars, tokens } from "../format.js";
import { Icon } from "./Icon.js";

/** Open/close state for a popover: closes on an outside press and on Escape. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey, true); };
  }, [open]);
  return { open, setOpen, ref };
}

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
export const modKey = isMac ? "⌘" : "Ctrl";

export function ModeMenu({ mode, onMode }: { mode: UiMode; onMode(m: UiMode): void }) {
  const { open, setOpen, ref } = usePopover();
  const cur = UI_MODES.find((m) => m.id === mode) ?? UI_MODES[0]!;
  return (
    <div className="pop-wrap" ref={ref}>
      <button type="button" className={`chip-btn mode ${mode}`} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title={`${cur.label}: ${cur.hint}`}>
        <Icon name={mode === "bypass" ? "shield" : mode === "plan" ? "layers" : mode === "ask" ? "search" : "bolt"} size={13} />
        <span className="chip-label">{cur.label}</span>
        <Icon name="chevronDown" size={11} />
      </button>
      {open && (
        <div className="popover mode-menu" role="menu">
          {UI_MODES.map((m) => (
            <button key={m.id} type="button" role="menuitemradio" aria-checked={m.id === mode} className={`menu-item${m.id === mode ? " on" : ""}`}
              onClick={() => { onMode(m.id); setOpen(false); }}>
              <span className="menu-main"><span className="menu-title">{m.label}</span><span className="menu-hint">{m.hint}</span></span>
              {m.id === mode && <Icon name="check" size={13} />}
            </button>
          ))}
          <div className="menu-foot">Use {modKey} . to switch modes</div>
        </div>
      )}
    </div>
  );
}

function Bars({ n }: { n: 0 | 1 | 2 | 3 }) {
  if (n === 0) return null;
  return <span className={`bars b${n}`} aria-label={n === 3 ? "fast" : n === 2 ? "medium" : "slow"}><i /><i /><i /></span>;
}

function Detail({ r }: { r: ModelRow }) {
  const lines: ReactNode[] = [
    <div key="p" className="det-row"><span>Provider</span><span>{r.provider || "unknown"}</span></div>,
    r.contextLength ? <div key="c" className="det-row"><span>Context</span><span>{tokens(r.contextLength)} tokens</span></div> : null,
    <div key="t" className="det-row"><span>First token</span><span>{r.p50Ms !== null ? `${seconds(r.p50Ms)} (median)` : "not measured yet"}</span></div>,
    <div key="o" className="det-row"><span>This workspace</span><span>{r.ok} ok{r.failed ? ` · ${r.failed} failed` : ""}</span></div>,
    r.benchedMin ? <div key="b" className="det-row warn"><span>Benched</span><span>{r.benchedMin} min left</span></div> : null,
  ];
  return <div className="model-detail">{lines}</div>;
}

export function ModelMenu({ current, rows, auto, onPick, onOpen }: { current: string; rows: readonly ModelRow[]; auto: boolean; onPick(name: string | null): void; onOpen(): void }) {
  const { open, setOpen, ref } = usePopover();
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const sections = useMemo(() => modelSections(rows, query), [rows, query]);
  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const short = current.split("/").at(-1) || "No model";
  const q = query.trim().toLowerCase();
  const showAuto = !q || "automatic".includes(q);
  const [cursor, setCursor] = useState(0);
  useEffect(() => { setCursor(0); }, [query, open]);
  useEffect(() => { if (open) { setQuery(""); setHover(null); onOpen(); } }, [open]);        // asks the host for fresh stats each time the menu opens

  const pick = (name: string | null) => { onPick(name); setOpen(false); };
  const onKey = (e: ReactKeyboardEvent) => {
    const n = flat.length + (showAuto ? 1 : 0);
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => (c + 1) % Math.max(1, n)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => (c - 1 + Math.max(1, n)) % Math.max(1, n)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (showAuto && cursor === 0) pick(null);
      else { const r = flat[cursor - (showAuto ? 1 : 0)]; if (r) pick(r.name); }
    }
  };
  const index = (name: string): number => flat.findIndex((r) => r.name === name) + (showAuto ? 1 : 0);

  return (
    <div className="pop-wrap" ref={ref}>
      <button type="button" className="chip-btn model" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} title={current ? `${current}${auto ? " (automatic)" : ""}` : "No model yet. Is TrueForge running?"}>
        <Icon name="sparkle" size={13} />
        <span className="chip-label">{short}</span>
        <Icon name="chevronDown" size={11} />
      </button>
      {open && (
        <div className="popover model-menu" role="listbox" aria-label="Models">
          <input className="menu-search" autoFocus placeholder="Search all models" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} aria-label="Search models" />
          <div className="menu-scroll">
            {showAuto && (
              <button type="button" role="option" aria-selected={auto} className={`menu-item${auto ? " on" : ""}${cursor === 0 ? " cur" : ""}`} onClick={() => pick(null)} onMouseEnter={() => setCursor(0)}>
                <span className="menu-main"><span className="menu-title">Automatic</span><span className="menu-hint">The configured order, with a fallback behind it</span></span>
                {auto && <Icon name="check" size={13} />}
              </button>
            )}
            {sections.map((s) => (
              <div key={s.id} className="menu-section">
                <div className="menu-section-title">{s.title}</div>
                {s.rows.map((r) => {
                  const on = !auto && r.name === current, i = index(r.name);
                  return (
                    <div key={r.name}>
                      <button type="button" role="option" aria-selected={on} className={`menu-item${on ? " on" : ""}${cursor === i ? " cur" : ""}`}
                        onClick={() => pick(r.name)} onMouseEnter={() => { setHover(r.name); setCursor(i); }} onFocus={() => setHover(r.name)}>
                        <span className="menu-main"><span className="menu-title">{r.short}</span><span className="menu-hint">{r.provider}</span></span>
                        {r.benchedMin ? <span className="tag warn">benched</span> : <Bars n={speedBars(r.p50Ms)} />}
                        {on && <Icon name="check" size={13} />}
                      </button>
                      {hover === r.name && <Detail r={r} />}
                    </div>
                  );
                })}
              </div>
            ))}
            {!flat.length && !showAuto && <div className="menu-empty">{rows.length ? "No model matches" : "No models yet. Start TrueForge, then reopen this menu."}</div>}
            {!rows.length && showAuto && <div className="menu-empty">No models yet. Start TrueForge, then reopen this menu.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
