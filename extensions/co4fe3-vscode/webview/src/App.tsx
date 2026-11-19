import { createElement as h, useEffect, useReducer, useState } from "react";
import type { Mode, PanelEvent, UiCommand } from "@co4fe3/agent-core/panel";
import { applyPanelEvent, emptyPanel } from "@co4fe3/agent-core/panel";
import { Transcript } from "./components/Transcript.js";
import { Header, Composer } from "./components/Header.js";
import { StatusLine, BoardCard } from "./components/rows.js";

type Post = (m: UiCommand) => void;

export function App({ post }: { post: Post }) {
  const [s, dispatch] = useReducer(applyPanelEvent, undefined, emptyPanel);
  const [mode, setModeState] = useState<Mode>("agent");
  const [model, setModel] = useState("…");

  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      const m = ev.data as { type: string; batch?: PanelEvent[]; model?: string; mode?: Mode };
      if (m.type === "events" && m.batch) for (const e of m.batch) dispatch(e);
      if (m.type === "hello" && m.model) setModel(m.model);
      if (m.type === "hello" && m.mode) setModeState(m.mode);
    };
    window.addEventListener("message", handler);
    post({ type: "ready" });
    return () => window.removeEventListener("message", handler);
  }, [post]);

  const decide = (key: string, hunkId: string, v: "accepted" | "rejected") => post({ type: "decide", key, hunkId, verdict: v });
  const open = (key: string) => post({ type: "openDiff", key });
  const commandVerdict = (id: string, v: "allow" | "deny") => post({ type: "command", id, verdict: v });

  return h("div", { className: "app" },
    h(Header, { mode, model, onMode: (m) => { setModeState(m); post({ type: "setMode", mode: m }); } }),
    h("div", { className: "scroll" },
      h(Transcript, { s, onDecide: decide, onOpen: open, onVerdict: commandVerdict }),
      h(BoardCard, { entries: s.board })),
    h(StatusLine, { e: s.status, sessionUrl: s.status?.sessionUrl, onOpenSession: () => post({ type: "openSession" }) }),
    h(Composer, { busy: s.status?.state === "running" || s.status?.state === "paused", onSend: (t) => post({ type: "send", text: t }), onStop: () => post({ type: "stop" }) }));
}
