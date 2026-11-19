import { createElement as h, memo, useState } from "react";
import type { Mode } from "@co4fe3/agent-core/panel";

export const Header = memo(function Header({ mode, model, onMode }: { mode: Mode; model: string; onMode(m: Mode): void }) {
  const modes: Mode[] = ["agent", "ask", "plan"];
  return h("div", { className: "header" },
    h("span", { className: "chip" }, `$(sparkle) ${model}`),
    modes.map((m) => h("button", { key: m, className: `chip ${m === mode ? "on" : ""}`, onClick: () => onMode(m) }, m)));
});

const ACTIVE_TOKEN = /(^|\s)(@[\w./-]*|\/[\w-]*)$/;

export const Composer = memo(function Composer({ busy, onSend, onStop, completions, onComplete }: {
  busy: boolean;
  onSend(text: string): void;
  onStop(): void;
  completions: { kind: "@" | "/"; items: string[] } | null;
  onComplete(kind: "@" | "/", prefix: string): void;
}) {
  const [draft, setDraft] = useState("");
  const submit = () => { const t = draft.trim(); if (!t) return; setDraft(""); onSend(t); };
  const onDraft = (v: string) => {
    setDraft(v);
    const m = ACTIVE_TOKEN.exec(v);                       // "@" anywhere or "/" at the start
    if (m && (m[2]!.startsWith("@") || m[2]!.startsWith("/") && m.index === 0)) {
      onComplete(m[2]!.slice(0, 1) as "@" | "/", m[2]!.slice(1));
    }
  };
  const pick = (item: string) => {
    const m = ACTIVE_TOKEN.exec(draft);
    setDraft(m ? `${draft.slice(0, m.index)}${m[1] ?? ""}${completions?.kind ?? "@"}${item} ` : draft);
  };
  return h("div", { className: "composer" },
    completions && completions.items.length > 0 && h("div", { className: "completions" },
      completions.items.slice(0, 8).map((it) => h("button", { key: it, className: "completion", onClick: () => pick(it) },
        `${completions.kind}${it}`))),
    h("textarea", {
      value: draft, placeholder: busy ? "Running — Send is Stop" : "Ask, @file or @symbol:Name, or /workflow",
      onChange: (e) => onDraft((e.target as HTMLTextAreaElement).value),
      onKeyDown: (e) => {
        if (e.key === "Enter" && !e.ctrlKey) { e.preventDefault(); submit(); }
        if (e.key === "Tab" && completions?.items[0]) { e.preventDefault(); pick(completions.items[0]); }
      },
    }),
    h("button", { className: "btn primary", onClick: busy ? onStop : submit }, busy ? "Stop" : "Send"));
});
