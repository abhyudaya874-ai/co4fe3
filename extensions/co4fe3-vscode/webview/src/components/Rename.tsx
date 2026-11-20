import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export const TITLE_MAX = 100;

/** A text field that replaces a title while it is renamed. Enter or leaving the field saves; Escape cancels. */
export function RenameInput({ value, placeholder, label, onCommit, onCancel }: {
  value: string; placeholder?: string; label: string; onCommit(text: string): void; onCancel(): void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false);                          // Enter or Escape already decided: the blur that follows must not decide again
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (save: boolean): void => {
    if (settled.current) return;
    settled.current = true;
    if (save) onCommit(ref.current?.value ?? value); else onCancel();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    e.stopPropagation();                                   // keys typed in the field are the field's, not the list's shortcuts
    if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
  };
  return (
    <input ref={ref} className="rename-input" defaultValue={value} placeholder={placeholder} maxLength={TITLE_MAX} aria-label={label} spellCheck={false}
      onKeyDown={onKey} onBlur={() => finish(true)} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} />
  );
}

/** A title that becomes a text field on double-click (when `onRename` is given). */
export function EditableTitle({ title, className, onRename }: { title: string; className?: string; onRename?: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing && onRename) {
    return <RenameInput value={title} label="Session name" onCancel={() => setEditing(false)} onCommit={(t) => { setEditing(false); onRename(t.trim()); }} />;
  }
  return (
    <span className={className} title={onRename ? `${title}\nDouble-click to rename` : title} onDoubleClick={onRename ? () => setEditing(true) : undefined}>{title}</span>
  );
}
