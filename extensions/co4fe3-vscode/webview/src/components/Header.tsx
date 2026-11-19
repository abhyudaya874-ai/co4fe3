import { createElement as h, memo, useState } from "react";
import type { Mode } from "@co4fe3/agent-core/panel";

export const Header = memo(function Header({ mode, model, onMode }: { mode: Mode; model: string; onMode(m: Mode): void }) {
  const modes: Mode[] = ["agent", "ask", "plan"];
  return h("div", { className: "header" },
    h("span", { className: "chip" }, `$(sparkle) ${model}`),
    modes.map((m) => h("button", { key: m, className: `chip ${m === mode ? "on" : ""}`, onClick: () => onMode(m) }, m)));
});

export const Composer = memo(function Composer({ busy, onSend, onStop }: { busy: boolean; onSend(text: string): void; onStop(): void }) {
  const [draft, setDraft] = useState("");
  const submit = () => { const t = draft.trim(); if (!t) return; setDraft(""); onSend(t); };
  return h("div", { className: "composer" },
    h("textarea", {
      value: draft, placeholder: busy ? "Running — Send is Stop" : "Ask, or /workflow",
      onChange: (e) => setDraft((e.target as HTMLTextAreaElement).value),
      onKeyDown: (e) => { if (e.key === "Enter" && !e.ctrlKey) { e.preventDefault(); submit(); } },
    }),
    h("button", { className: "btn primary", onClick: busy ? onStop : submit }, busy ? "Stop" : "Send"));
});
