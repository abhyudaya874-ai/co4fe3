import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { selectionLabel, type ChromeState, type CompletionItem, type ModelRow, type PanelEvent, type SelectionRef, type UiMode } from "@co4fe3/agent-core/panel";
import type { IconName } from "../format.js";
import { Icon } from "./Icon.js";
import { ModeMenu, ModelMenu } from "./menus.js";
import { ContextMeter } from "./ContextMeter.js";

const ACTIVE_TOKEN = /(^|\s)(@[\w./:-]*|\/[\w-]*)$/;                 // matched against the text BEFORE the caret
const ICON: Record<CompletionItem["kind"], IconName> = { file: "file", folder: "folder", symbol: "sparkle", rule: "book", skill: "bolt", workflow: "slash" };

/** The "@" or "/" token that ends at the caret, or null. "/" counts only at the very start of the message. */
export function tokenAt(text: string, caret: number): { kind: "@" | "/"; prefix: string; start: number } | null {
  const m = ACTIVE_TOKEN.exec(text.slice(0, caret));
  if (!m) return null;
  const tok = m[2]!, start = m.index + (m[1]?.length ?? 0);
  if (tok.startsWith("/") && start !== 0) return null;
  return { kind: tok[0] as "@" | "/", prefix: tok.slice(1), start };
}

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
  completions: { kind: "@" | "/"; prefix: string; items: CompletionItem[] } | null;
  clearCompletions(): void;
  onSend(text: string, attach?: SelectionRef): void;
  onStop(): void;
  onFocus(): void;
  onComplete(kind: "@" | "/", prefix: string): void;
  onMode(m: UiMode): void;
  onModel(name: string | null): void;
  onModelsOpen(): void;
  /** The person removed the attached selection. */
  onDetach(): void;
  /** Bumps when the chat was opened for a selection (Chat, Ctrl+L): focus the box. */
  focusTick: number;
  /** The context ring: the lead's last model call, and this conversation's latest context pack. */
  usage?: Extract<PanelEvent, { kind: "usage" }> | null;
  pack?: Extract<PanelEvent, { kind: "pack" }>["pack"] | null;
}

/** The input card: a growing text box, the editor selection as a chip, and the mode, model and send controls along its bottom edge. */
export const Composer = memo(function Composer(p: ComposerProps) {
  const { chrome, draft, setDraft, completions } = p;
  const ta = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(0);
  const [token, setToken] = useState<ReturnType<typeof tokenAt>>(() => tokenAt(draft, draft.length));
  const list = useRef<HTMLDivElement>(null);
  const busy = chrome.busy;

  // The selection chip: only what the person sent with Chat (Ctrl+L). Selecting text alone never puts anything here.
  const chip = chrome.attached;
  useEffect(() => { if (p.focusTick > 0) ta.current?.focus(); }, [p.focusTick]);

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
  const onDraft = (v: string, caret = v.length) => {
    setDraft(v);
    const t = tokenAt(v, caret);                                        // "@" anywhere, "/" only at the start
    setToken(t);
    if (t) p.onComplete(t.kind, t.prefix);
    else p.clearCompletions();
  };
  // A reply for an older token (the user kept typing) is not shown: the newer reply follows.
  const items = completions && token && completions.kind === token.kind && completions.prefix === token.prefix ? completions.items : [];
  useLayoutEffect(() => { list.current?.querySelector(".completion.cur")?.scrollIntoView({ block: "nearest" }); }, [cursor]);
  const pickCompletion = (item: CompletionItem) => {
    if (token) {
      const end = token.start + 1 + token.prefix.length;
      const rest = draft.slice(end);
      const next = `${draft.slice(0, token.start)}${token.kind}${item.insert}${rest.startsWith(" ") ? "" : " "}${rest}`;
      setDraft(next);
      const caret = token.start + 1 + item.insert.length + 1;
      requestAnimationFrame(() => ta.current?.setSelectionRange(caret, caret));
    }
    setToken(null);
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
    ta.current?.setSelectionRange(next.length, next.length);
  };

  return (
    <div className="composer-wrap">
      {items.length > 0 && (
        <div className="completions" ref={list} role="listbox" aria-label={completions?.kind === "@" ? "Files, folders, symbols, rules and skills" : "Workflows and skills"}>
          {items.map((it, i) => (
            <Fragment key={`${it.kind}:${it.insert}`}>
              {(i === 0 || items[i - 1]!.group !== it.group) && <div className="completion-group" role="presentation">{it.group}</div>}
              <button type="button" role="option" aria-selected={i === cursor} className={`completion ${it.kind}${i === cursor ? " cur" : ""}`} title={`${token?.kind ?? ""}${it.insert}`}
                onMouseDown={(ev) => { ev.preventDefault(); pickCompletion(it); }} onMouseMove={() => { if (i !== cursor) setCursor(i); }}>
                <Icon name={ICON[it.kind]} size={13} />
                <span className="completion-label">{it.label}</span>
                {it.detail && <span className="completion-detail">{it.detail}</span>}
              </button>
            </Fragment>
          ))}
        </div>
      )}
      <div className={`composer${busy ? " busy" : ""}`}>
        {chip && (
          <div className="chips">
            <span className="attach-chip" title={`${chip.path} lines ${chip.start}-${chip.end}`}>
              <Icon name="file" size={12} />{selectionLabel(chip)}
              <button type="button" className="chip-x" aria-label="Remove the attached selection" onClick={p.onDetach}><Icon name="x" size={11} /></button>
            </span>
          </div>
        )}
        <textarea ref={ta} rows={1} value={draft} placeholder={placeholderFor(chrome.mode, busy)} aria-label="Message the agent" spellCheck={false}
          onFocus={p.onFocus} onChange={(e) => onDraft(e.target.value, e.target.selectionStart ?? e.target.value.length)} onKeyDown={onKeyDown} />
        <div className="composer-bar">
          <div className="bar-left">
            <button type="button" className="icon-btn round" onClick={() => insert("@")} title="Mention a file or symbol" aria-label="Mention a file or symbol"><Icon name="plus" size={14} /></button>
            <button type="button" className="icon-btn round" onClick={() => insert("/")} title="Run a workflow" aria-label="Run a workflow"><Icon name="slash" size={13} /></button>
          </div>
          <div className="bar-chips">
            <ModeMenu mode={chrome.mode} onMode={p.onMode} />
            <ModelMenu current={chrome.model} rows={p.models.rows} auto={p.models.auto} onPick={p.onModel} onOpen={p.onModelsOpen} />
          </div>
          <ContextMeter usage={p.usage ?? null} pack={p.pack ?? null} />
          <button type="button" className={`send${busy ? " stop" : ""}`} onClick={busy ? p.onStop : submit} disabled={!busy && !draft.trim()}
            aria-label={busy ? "Stop" : "Send"} title={busy ? "Stop" : "Send (Enter)"}>
            <Icon name={busy ? "stop" : "arrowUp"} size={busy ? 12 : 15} />
          </button>
        </div>
      </div>
    </div>
  );
});
