import { createElement as h, memo, useState } from "react";
import type { PanelEvent } from "@co4fe3/agent-core/panel";
import { md } from "../md.js";
import { renderPack } from "@co4fe3/agent-core/panel";

export const UserBubble = memo(function UserBubble({ e }: { e: Extract<PanelEvent, { kind: "user" }> }) {
  return h("div", { className: "row user" }, h("div", { className: "bubble user-bubble" }, e.text));
});

export const TextRow = memo(function TextRow({ e }: { e: Extract<PanelEvent, { kind: "text" }> }) {
  return h("div", { className: "row text" }, md(e.text || "…"));
});

export const Thoughts = memo(function Thoughts({ e }: { e: Extract<PanelEvent, { kind: "text" }> }) {
  if (!e.reasoning) return null;
  return h("details", { className: "row thoughts" }, h("summary", null, "thinking"), h("div", { className: "muted" }, e.reasoning));
});

export const ToolCard = memo(function ToolCard({ e }: { e: Extract<PanelEvent, { kind: "tool" }> }) {
  return h("div", { className: `card tool ${e.state}` },
    h("div", { className: "card-head" }, h("span", { className: "codicon codicon-tools" }), " ", e.name, " ", h("span", { className: "muted" }, e.ms != null ? `${e.ms} ms` : e.state)),
    h("pre", { className: "args" }, shorten(e.args, 300)),
    e.result !== undefined && h("details", null, h("summary", null, "result"), h("pre", null, shorten(e.result, 4000))));
});

export const MemberRow = memo(function MemberRow({ e }: { e: Extract<PanelEvent, { kind: "member" }> }) {
  return h("div", { className: `row member ${e.status}` },
    h("span", { className: "chip" }, e.profile ?? "member"), " ",
    h("strong", null, e.title), " ",
    h("span", { className: "muted" }, e.status),
    e.reason && h("div", { className: "muted" }, e.reason));
});

export const MessageBubble = memo(function MessageBubble({ e }: { e: Extract<PanelEvent, { kind: "message" }> }) {
  const who = e.from === "main" ? `lead → ${e.to}` : `${e.from} → lead`;
  const lines = e.text.split("\n");
  return h("div", { className: `row message ${e.from === "main" ? "brief" : "report"}` },
    lines.length > 3
      ? h("details", { className: "msg-collapse" }, h("summary", null, who, " · ", h("span", { className: "muted" }, `${lines.length} lines`)), md(e.text))
      : h("div", null, h("div", { className: "muted" }, who), md(e.text)));
});

export const PackCard = memo(function PackCard({ e }: { e: Extract<PanelEvent, { kind: "pack" }> }) {
  const p = e.pack;
  const [sent, setSent] = useState(false);
  if (!p.items.length) return h("div", { className: "card pack muted" }, "Context · skipped (index still building)");
  const tag = p.path === "quick" ? " · quick pack" : p.path === "none" ? " · no pack" : "";
  const ranksOf = (why: string[]): string => (why.at(-1)?.includes("#") ? why.at(-1)! : "");
  const reasonsOf = (why: string[]): string[] => (why.at(-1)?.includes("#") ? why.slice(0, -1) : why);
  return h("div", { className: "card pack" },
    h("div", { className: "card-head" },
      `Context · ${p.items.length} file${p.items.length === 1 ? "" : "s"} · ${p.used.toLocaleString()} / ${p.budget.toLocaleString()} tok`,
      tag && h("span", { className: "chip warn" }, tag),
      " ", h("button", { className: "link", onClick: () => setSent(!sent) }, sent ? "Hide" : "View as sent")),
    h("div", { className: "pack-bar" }, h("div", { className: "pack-fill", style: `width:${Math.min(100, (p.used / Math.max(1, p.budget)) * 100)}%` })),
    sent
      ? h("pre", { className: "pack-sent" }, renderPack(p))
      : p.items.map((i) => h("div", { key: i.path, className: `pack-row${i.pinned ? " pinned" : ""}` },
          h("span", { className: "pack-path" }, i.path), " ",
          h("span", { className: "muted" }, `${i.tokens} tok`),
          reasonsOf(i.why).map((r, k) => h("span", { key: k, className: "muted" }, ` · ${r}`)),
          ranksOf(i.why) && h("span", { className: "ranks" }, ranksOf(i.why).split(" · ").map((r, k) => h("span", { key: k, className: "rank-chip" }, r))))),
    !sent && p.skipped.length > 0 && h("div", { className: "muted" }, `+${p.skipped.length} more ranked files were left out (over budget)`));
});

export const BoardCard = memo(function BoardCard({ entries }: { entries: { key: string; value: string; by: string; at: number }[] }) {
  if (!entries.length) return null;
  return h("div", { className: "card board" },
    h("div", { className: "card-head" }, "Crew board"),
    entries.map((e) => h("div", { key: e.key }, h("span", { className: "pack-path" }, e.key), ` (${e.by}): ${e.value}`)));
});

export const DiffCard = memo(function DiffCard({ e, onDecide, onOpen }: {
  e: Extract<PanelEvent, { kind: "proposal" }>;
  onDecide(key: string, hunkId: string, v: "accepted" | "rejected"): void;
  onOpen(key: string): void;
}) {
  const pending = e.hunks.filter((x) => e.verdict[x.id] === "pending").length;
  return h("div", { className: "card proposal" },
    h("div", { className: "card-head" },
      h("span", { className: "codicon codicon-diff" }), " ",
      h("button", { className: "link", onClick: () => onOpen(e.key) }, e.path),
      ` +${e.adds} −${e.removes} · ${e.by}`),
    h("div", { className: "muted" }, e.why),
    e.applied && h("div", { className: "muted" }, e.applied.newErrors.length ? `new errors: ${e.applied.newErrors.join(" · ")}` : "no new errors"),
    h("div", { className: "hunks" }, e.hunks.map((x) => h("div", { key: x.id, className: `hunk ${e.verdict[x.id]}` },
      h("span", { className: "muted" }, `hunk ${x.id} @${x.oldStart + 1}`), " ",
      h("button", { className: "btn", disabled: e.verdict[x.id] !== "pending", onClick: () => onDecide(e.key, x.id, "accepted") }, "✓"),
      " ",
      h("button", { className: "btn", disabled: e.verdict[x.id] !== "pending", onClick: () => onDecide(e.key, x.id, "rejected") }, "✗")))),
    pending > 0 && h("div", null,
      h("button", { className: "btn", onClick: () => e.hunks.filter((x) => e.verdict[x.id] === "pending").forEach((x) => onDecide(e.key, x.id, "accepted")) }, "Accept all"),
      " ",
      h("button", { className: "btn", onClick: () => e.hunks.filter((x) => e.verdict[x.id] === "pending").forEach((x) => onDecide(e.key, x.id, "rejected")) }, "Reject all")));
});

export const CommandCard = memo(function CommandCard({ e, onVerdict }: { e: Extract<PanelEvent, { kind: "command" }>; onVerdict(id: string, v: "allow" | "deny"): void }) {
  return h("div", { className: `card command ${e.state}` },
    h("div", { className: "card-head" }, h("span", { className: "codicon codicon-terminal" }), " ", e.command),
    e.output !== undefined && h("pre", null, shorten(e.output, 2000)),
    e.state === "asking" && h("div", null,
      h("button", { className: "btn", onClick: () => onVerdict(e.id, "allow") }, "Allow"),
      " ",
      h("button", { className: "btn", onClick: () => onVerdict(e.id, "deny") }, "Deny")));
});

export const ModelBanner = memo(function ModelBanner({ e }: { e: Extract<PanelEvent, { kind: "model" }> }) {
  const n = e.note;
  if (n.kind === "answered" && n.fellBack) return h("div", { className: "banner" }, `Answered by ${n.model} (the primary model failed).`);
  if (n.kind === "failed") return h("div", { className: "banner" }, `${n.model}: ${n.failure.detail}${n.next ? ` → trying ${n.next}` : ""}`);
  return null;
});

export const Marker = memo(function Marker({ e }: { e: Extract<PanelEvent, { kind: "marker" }> }) {
  return h("div", { className: "row marker muted" }, `— ${e.text} —`);
});

export const StatusLine = memo(function StatusLine({ e, sessionUrl, onOpenSession }: { e: Extract<PanelEvent, { kind: "status" }> | null; sessionUrl?: string; onOpenSession(): void }) {
  if (!e) return null;
  return h("div", { className: `status ${e.state}` },
    e.message ?? e.state,
    sessionUrl && h("button", { className: "link", onClick: onOpenSession }, "Open session in TrueForge"));
});

const shorten = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max)}…(+${s.length - max} chars)`);
