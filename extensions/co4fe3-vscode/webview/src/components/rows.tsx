import { memo, useLayoutEffect, useRef, useState } from "react";
import type { PanelEvent } from "@co4fe3/agent-core/panel";
import { renderPack, selectionLabel } from "@co4fe3/agent-core/panel";
import { md } from "../md.js";
import { useActions } from "../actions.js";
import { toolLabel, hasOwnCard } from "../format.js";
import { Icon, Spinner } from "./Icon.js";

type Of<K extends PanelEvent["kind"]> = Extract<PanelEvent, { kind: K }>;

const shorten = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max)}…(+${s.length - max} chars)`);
const pretty = (json: string): string => { try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; } };

export const UserBubble = memo(function UserBubble({ e }: { e: Of<"user"> }) {
  const { openFile } = useActions();
  return (
    <div className="row user">
      <div className="bubble">
        {e.attach && (
          <button type="button" className="attach-chip" title={`Open ${e.attach.path}`} onClick={() => openFile(e.attach!.path, e.attach!.start)}>
            <Icon name="file" size={12} />{selectionLabel(e.attach)}
          </button>
        )}
        <div className="bubble-text">{e.text}</div>
      </div>
    </div>
  );
});

/** The model's text, with its reasoning folded above it as "Thoughts". `live`: this is the row still being written. */
export const AssistantText = memo(function AssistantText({ e, live }: { e: Of<"text">; live: boolean }) {
  const { openFile } = useActions();
  const [open, setOpen] = useState(false);
  const hasText = e.text.trim().length > 0;
  if (!hasText && !e.reasoning) return null;
  return (
    <div className="row assistant">
      {e.reasoning && (
        <div className="thoughts">
          <button type="button" className="thoughts-head" onClick={() => setOpen(!open)} aria-expanded={open}>
            <Icon name="brain" size={13} />
            <span>{live && !hasText ? "Thinking" : "Thoughts"}</span>
            {live && !hasText && <Spinner size={11} />}
            <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />
          </button>
          {open && <div className="thoughts-body">{e.reasoning}</div>}
        </div>
      )}
      {hasText && <div className="md">{md(e.text, { onFile: openFile })}</div>}
    </div>
  );
});

export const ToolRow = memo(function ToolRow({ e }: { e: Of<"tool"> }) {
  const { openFile } = useActions();
  const [open, setOpen] = useState(false);
  if (hasOwnCard(e.name)) return null;                                  // the command card shows this call
  const { verb, target, icon } = toolLabel(e.name, e.args);
  const isFile = (icon === "file" || icon === "edit") && !!target;
  const filePath = target.replace(/:\d+(-\d+)?$/, "");
  return (
    <div className={`tool ${e.state}`}>
      <button type="button" className="tool-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="tool-ic"><Icon name={icon} size={13} /></span>
        <span className="tool-verb">{verb}</span>
        {target && (isFile
          ? <span className="tool-target link" role="link" tabIndex={0} title={`Open ${filePath}`}
              onClick={(ev) => { ev.stopPropagation(); openFile(filePath, Number(/:(\d+)/.exec(target)?.[1]) || undefined); }}
              onKeyDown={(ev) => { if (ev.key === "Enter") { ev.stopPropagation(); openFile(filePath); } }}>{target}</span>
          : <span className="tool-target">{target}</span>)}
        <span className="tool-state">{e.state === "running" ? <Spinner size={12} /> : e.state === "ok" ? <Icon name="check" size={12} /> : <Icon name="alert" size={12} />}</span>
      </button>
      {open && (
        <div className="tool-detail">
          {e.args && <pre className="detail-pre">{shorten(pretty(e.args), 1500)}</pre>}
          {e.result !== undefined && <pre className="detail-pre result">{shorten(e.result, 4000)}</pre>}
        </div>
      )}
    </div>
  );
});

const MEMBER_LABEL: Record<Of<"member">["status"], string> = {
  running: "working", "waiting-approval": "waiting for your review", completed: "done", blocked: "blocked", failed: "failed", cancelled: "cancelled",
};
export const MemberRow = memo(function MemberRow({ e }: { e: Of<"member"> }) {
  return (
    <div className={`member ${e.status}`}>
      <span className="member-ic"><Icon name="users" size={13} /></span>
      <strong className="member-title">{e.title}</strong>
      <span className="chip">{e.profile ?? "member"}</span>
      <span className="member-status">{e.status === "running" ? <Spinner size={11} /> : <span className={`dot ${e.status}`} />}{MEMBER_LABEL[e.status]}</span>
      {e.reason && <div className="member-reason">{e.reason}</div>}
    </div>
  );
});

/** A brief the lead sent to a member, or the member's report back. Folded, because the lead's answer carries what matters. */
export const MessageBubble = memo(function MessageBubble({ e }: { e: Of<"message"> }) {
  const { openFile } = useActions();
  const brief = e.from === "main";
  const lines = e.text.split("\n").length;
  return (
    <details className={`msg ${brief ? "brief" : "report"}`}>
      <summary><Icon name={brief ? "arrowUp" : "arrowDown"} size={12} />{brief ? `Brief for ${e.to}` : `Report from ${e.from}`}<span className="muted"> · {lines} line{lines === 1 ? "" : "s"}</span></summary>
      <div className="md">{md(e.text, { onFile: openFile })}</div>
    </details>
  );
});

export const PackCard = memo(function PackCard({ e }: { e: Of<"pack"> }) {
  const p = e.pack;
  const [sent, setSent] = useState(false);
  if (!p.items.length) return <div className="ctx-line muted"><Icon name="layers" size={12} />Context skipped (the index is still building)</div>;
  const pct = Math.min(100, (p.used / Math.max(1, p.budget)) * 100);
  const reasons = (why: string[]): string[] => (why.at(-1)?.includes("#") ? why.slice(0, -1) : why);
  return (
    <details className="ctx">
      <summary>
        <Icon name="layers" size={12} />
        <span>Context · {p.items.length} file{p.items.length === 1 ? "" : "s"} · {p.used.toLocaleString()} / {p.budget.toLocaleString()} tokens</span>
        {p.path !== "full" && <span className="chip warn">{p.path === "quick" ? "quick pack" : "no pack"}</span>}
      </summary>
      <div className="ctx-bar"><div className="ctx-fill" style={{ width: `${pct}%` }} /></div>
      <button type="button" className="link-btn" onClick={() => setSent(!sent)}>{sent ? "Hide the text sent" : "View as sent"}</button>
      {sent
        ? <pre className="detail-pre">{renderPack(p)}</pre>
        : p.items.map((i) => (
            <div key={i.path} className={`ctx-row${i.pinned ? " pinned" : ""}`}>
              <span className="ctx-path">{i.path}</span>
              <span className="muted">{i.tokens} tok{reasons(i.why).length ? ` · ${reasons(i.why).join(" · ")}` : ""}</span>
            </div>
          ))}
      {!sent && p.skipped.length > 0 && <div className="muted">+{p.skipped.length} more ranked files were left out (over budget)</div>}
    </details>
  );
});

export const BoardCard = memo(function BoardCard({ entries }: { entries: Of<"board">["entries"] }) {
  if (!entries.length) return null;
  return (
    <details className="ctx board">
      <summary><Icon name="users" size={12} /><span>Crew board · {entries.length} note{entries.length === 1 ? "" : "s"}</span></summary>
      {entries.map((b) => <div key={b.key} className="ctx-row"><span className="ctx-path">{b.key}</span><span className="muted">{b.by}: {b.value}</span></div>)}
    </details>
  );
});

/** The first word of a command, for the card's title: "pytest -q" → "pytest", "cd x && ls" → "cd". */
export const commandName = (command: string): string => /^\s*(?:\w+=\S*\s+)*([^\s|&;]+)/.exec(command)?.[1]?.split("/").at(-1) ?? "shell";

const OUTPUT_LINES = 14;                                              // lines the output box shows before it scrolls

/** A shell command as Devin shows it: the command, its output right under it, and how it ended. */
export const CommandCard = memo(function CommandCard({ e }: { e: Of<"command"> }) {
  const { command } = useActions();
  const [all, setAll] = useState(false);
  const box = useRef<HTMLPreElement>(null);
  const running = e.state === "running";
  const out = e.output ?? "";
  const lines = out === "" ? 0 : out.replace(/\n$/, "").split("\n").length;
  const failed = e.state === "done" && e.exit !== undefined && e.exit !== 0;
  useLayoutEffect(() => { const el = box.current; if (el && running) el.scrollTop = el.scrollHeight; }, [out, running]);   // follow the tail while it runs
  return (
    <div className={`cmd ${e.state}${failed ? " failed" : ""}`}>
      <div className="cmd-head">
        <span className="tool-ic"><Icon name="terminal" size={13} /></span>
        <span className="tool-verb">Command</span>
        <span className="cmd-name">{commandName(e.command)}</span>
        <span className="tool-state">{running && <Spinner size={12} />}{e.state === "denied" && <span className="chip">not run</span>}</span>
      </div>
      <pre className="cmd-line" title={e.command}><span className="cmd-prompt" aria-hidden="true">$ </span>{e.command}</pre>
      {e.state === "asking" && (
        <div className="cmd-ask">
          <span className="muted">Run this command?</span>
          <button type="button" className="btn" onClick={() => command(e.id, "deny")}>Deny</button>
          <button type="button" className="btn primary" onClick={() => command(e.id, "allow")} autoFocus>Allow</button>
        </div>
      )}
      {out !== "" && (
        <>
          <pre ref={box} className={`cmd-out${all ? " all" : ""}`} tabIndex={0} aria-label="Command output">{shorten(out, 20_000)}</pre>
          {lines > OUTPUT_LINES && <button type="button" className="link-btn cmd-more" onClick={() => setAll(!all)}>{all ? "Show less" : `Show all ${lines} lines`}</button>}
        </>
      )}
      {e.state === "denied" && e.output === undefined && <div className="cmd-end muted">Not run: you denied it.</div>}
      {e.state === "done" && (
        <div className={`cmd-end${failed ? " bad" : ""}`}>
          <Icon name={failed ? "alert" : "check"} size={12} />
          <span>{e.exit === null || e.exit === undefined ? "Finished" : `Exited with code ${e.exit}`}{e.seconds != null ? ` · ${e.seconds.toFixed(e.seconds < 10 ? 1 : 0)} s` : ""}{e.note ? ` · ${e.note}` : ""}</span>
        </div>
      )}
      {running && out === "" && <div className="cmd-end muted">Running…</div>}
    </div>
  );
});

/** Task C on screen: which model failed, why, and who answered instead. */
export const ModelBanner = memo(function ModelBanner({ e }: { e: Of<"model"> }) {
  const n = e.note;
  if (n.kind === "answered" && n.fellBack) return <div className="banner warn" role="status"><Icon name="alert" size={14} /><span>Answered by <strong>{n.model}</strong> (the first model failed).</span></div>;
  if (n.kind === "failed") return <div className="banner warn" role="status"><Icon name="alert" size={14} /><span><strong>{n.model}</strong>: {n.failure.detail}{n.next ? <> → trying <strong>{n.next}</strong></> : null}</span></div>;
  return null;
});

export const Marker = memo(function Marker({ e }: { e: Of<"marker"> }) {
  return <div className="marker muted">{e.text}</div>;
});

export const LatencyLine = memo(function LatencyLine({ e }: { e: Of<"latency"> }) {
  return <div className="latency muted" title="Measured on this request">{e.line}</div>;
});

/** Names that open their file in the editor. A name with no known path stays plain text. */
function FileLinks({ names, paths }: { names: readonly string[]; paths?: readonly string[] }) {
  const { openFile } = useActions();
  return (
    <>
      {names.map((n, i) => {
        const p = paths?.[i];
        return (
          <span key={`${n}:${i}`}>
            {i > 0 && ", "}
            {p ? <button type="button" className="link-btn inline-link" title={`Open ${p}`} onClick={() => openFile(p)}>{n}</button> : n}
          </span>
        );
      })}
    </>
  );
}
export const InstructionsLine = memo(function InstructionsLine({ e }: { e: Of<"instructions"> }) {
  const total = e.inline.length + e.activeSkills.length;
  if (!total && !e.onDemand) return null;
  return (
    <details className="ctx instr">
      <summary><Icon name="book" size={12} /><span>Project instructions · {e.inline.length} loaded{e.activeSkills.length ? ` · ${e.activeSkills.length} skill${e.activeSkills.length === 1 ? "" : "s"}` : ""}{e.onDemand ? ` · ${e.onDemand} on demand` : ""}</span></summary>
      {e.inline.length > 0 && <div className="muted">Loaded: <FileLinks names={e.inline} paths={e.inlinePaths} /></div>}
      {e.activeSkills.length > 0 && <div className="muted">Skills: <FileLinks names={e.activeSkills} paths={e.skillPaths} /></div>}
    </details>
  );
});
