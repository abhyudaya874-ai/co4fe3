import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { selectionLabel, type ChromeState, type ModelRow, type SelectionRef, type UiMode } from "@co4fe3/agent-core/panel";
import { Icon } from "./Icon.js";
import { ModeMenu, ModelMenu } from "./menus.js";

const ACTIVE_TOKEN = /(^|\s)(@[\w./-]*|\/[\w-]*)$/;

const placeholderFor = (mode: UiMode, busy: boolean): string =>
  busy ? "Working… stop it with the red button" :
  mode === "ask" ? "Ask a question about this code" :
  mode === "plan" ? "Describe what to plan" :
  "Ask anything, @ to mention a file, / for a workflow";

export interface ComposerProps {
  chrome: ChromeState;
  models: { rows: readonly ModelRow[]; auto: boolean };
  draft: string;
  setDraft(v: string): void;
  completions: { kind: "@" | "/"; items: string[] } | null;
  clearCompletions(): void;
  onSend(text: string, attach?: SelectionRef): void;
  onStop(): void;
  onFocus(): void;
  onComplete(kind: "@" | "/", prefix: string): void;
  onMode(m: UiMode): void;
  onModel(name: string | null): void;
  onModelsOpen(): void;
}

/** The input card: a growing text box, the editor selection as a chip, and the mode, model and send controls along its bottom edge. */
export const Composer = memo(function Composer(p: ComposerProps) {
  const { chrome, draft, setDraft, completions } = p;
  const ta = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const busy = chrome.busy;

  // The selection chip: shown while the editor has a selection, until the user dismisses that exact selection.
  const sel = chrome.selection;
  const selKey = sel ? `${sel.path}:${sel.start}-${sel.end}` : null;
  const chip = sel && selKey !== dismissed ? sel : null;

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft]);
  useEffect(() => { setCursor(0); }, [completions]);

  const submit = () => {
    const t = draft.trim();
    if (!t || busy) return;
    p.onSend(t, chip ?? undefined);
    setDraft("");
    p.clearCompletions();
  };
  const onDraft = (v: string) => {
    setDraft(v);
    const m = ACTIVE_TOKEN.exec(v);                                     // "@" anywhere, "/" only at the start
    if (m && (m[2]!.startsWith("@") || (m[2]!.startsWith("/") && m.index === 0))) p.onComplete(m[2]!.slice(0, 1) as "@" | "/", m[2]!.slice(1));
    else p.clearCompletions();
  };
  const items = completions?.items.slice(0, 8) ?? [];
  const pickCompletion = (item: string) => {
    const m = ACTIVE_TOKEN.exec(draft);
    if (m) setDraft(`${draft.slice(0, m.index)}${m[1] ?? ""}${completions?.kind ?? "@"}${item} `);
    p.clearCompletions();
    ta.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (items.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => (c + 1) % items.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => (c - 1 + items.length) % items.length); return; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); pickCompletion(items[cursor] ?? items[0]!); return; }
      if (e.key === "Escape") { e.preventDefault(); p.clearCompletions(); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };
  const insert = (token: "@" | "/") => {
    const next = token === "/" ? (draft.startsWith("/") ? draft : `/${draft}`) : `${draft}${draft && !/\s$/.test(draft) ? " " : ""}@`;
    onDraft(next);
    ta.current?.focus();
  };

  return (
    <div className="composer-wrap">
      {items.length > 0 && (
        <div className="completions" role="listbox" aria-label={completions?.kind === "@" ? "Files and symbols" : "Workflows"}>
          {items.map((it, i) => (
            <button key={it} type="button" role="option" aria-selected={i === cursor} className={`completion${i === cursor ? " cur" : ""}`} onMouseDown={(ev) => { ev.preventDefault(); pickCompletion(it); }}>
              <Icon name={completions?.kind === "@" ? (it.startsWith("symbol:") ? "sparkle" : "file") : "slash"} size={12} />
              <span>{completions?.kind}{it}</span>
            </button>
          ))}
        </div>
      )}
      <div className={`composer${busy ? " busy" : ""}`}>
        {chip && (
          <div className="chips">
            <span className="attach-chip" title={`${chip.path} lines ${chip.start}-${chip.end}`}>
              <Icon name="file" size={12} />{selectionLabel(chip)}
              <button type="button" className="chip-x" aria-label="Do not attach the selection" onClick={() => setDismissed(selKey)}><Icon name="x" size={11} /></button>
            </span>
          </div>
        )}
        <textarea ref={ta} rows={1} value={draft} placeholder={placeholderFor(chrome.mode, busy)} aria-label="Message the agent" spellCheck={false}
          onFocus={p.onFocus} onChange={(e) => onDraft(e.target.value)} onKeyDown={onKeyDown} />
        <div className="composer-bar">
          <div className="bar-left">
            <button type="button" className="icon-btn round" onClick={() => insert("@")} title="Mention a file or symbol" aria-label="Mention a file or symbol"><Icon name="plus" size={14} /></button>
            <button type="button" className="icon-btn round" onClick={() => insert("/")} title="Run a workflow" aria-label="Run a workflow"><Icon name="slash" size={13} /></button>
          </div>
          <div className="bar-chips">
            <ModeMenu mode={chrome.mode} onMode={p.onMode} />
            <ModelMenu current={chrome.model} rows={p.models.rows} auto={p.models.auto} onPick={p.onModel} onOpen={p.onModelsOpen} />
          </div>
          <button type="button" className={`send${busy ? " stop" : ""}`} onClick={busy ? p.onStop : submit} disabled={!busy && !draft.trim()}
            aria-label={busy ? "Stop" : "Send"} title={busy ? "Stop" : "Send (Enter)"}>
            <Icon name={busy ? "stop" : "arrowUp"} size={busy ? 12 : 15} />
          </button>
        </div>
      </div>
    </div>
  );
});
