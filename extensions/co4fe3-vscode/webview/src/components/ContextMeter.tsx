import { memo, useState } from "react";
import type { PanelEvent } from "@co4fe3/agent-core/panel";

type Usage = Extract<PanelEvent, { kind: "usage" }>;
type ContextPack = Extract<PanelEvent, { kind: "pack" }>["pack"];

/** 46_213 → "46K", 2_863 → "2.9K", 262_144 → "262K". */
export const kTokens = (n: number): string => (n < 1000 ? String(n) : n < 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : `${Math.round(n / 1000)}K`);

const PARTS: { key: keyof Usage["breakdown"]; label: string }[] = [
  { key: "messages", label: "Conversation" },
  { key: "instructions", label: "Instructions and rules" },
  { key: "toolDefinitions", label: "Tool definitions" },
  { key: "skills", label: "Skills" },
  { key: "harness", label: "TrueForge framing" },
];

/**
 * Devin's context ring: how full the lead's context window is after its last model call, from TrueForge's own usage
 * numbers. Hover or click for the breakdown, the prompt cache, and what this message's context pack added.
 */
export const ContextMeter = memo(function ContextMeter({ usage, pack }: { usage: Usage | null; pack: ContextPack | null }) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  if (!usage) return null;
  const used = usage.inputTokens + usage.outputTokens;                 // the next call starts from everything the last one saw and said
  const pct = usage.window ? Math.min(100, (used / usage.window) * 100) : null;
  const level = pct === null ? "" : pct >= 85 ? " bad" : pct >= 60 ? " warn" : "";
  const R = 6.5, C = 2 * Math.PI * R;
  const sum = Object.values(usage.breakdown).reduce((a, b) => a + b, 0) || 1;
  const headline = pct === null ? `${kTokens(used)} tokens in context` : `${Math.round(pct)}% (${kTokens(used)} / ${kTokens(usage.window!)}) context used`;
  const cacheShare = usage.cacheReadTokens ? Math.round((usage.cacheReadTokens / Math.max(1, usage.inputTokens)) * 100) : 0;
  return (
    <div className="ctx-meter-wrap" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button type="button" className={`ctx-meter${level}`} aria-label={headline} aria-expanded={pinned || hover} onClick={() => setPinned(!pinned)}>
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r={R} className="ring-bg" />
          <circle cx="8" cy="8" r={R} className="ring-fg" strokeDasharray={`${(C * (pct ?? 0)) / 100} ${C}`} transform="rotate(-90 8 8)" />
        </svg>
      </button>
      {(pinned || hover) && (
        <div className="ctx-pop" role="dialog" aria-label="Context window">
          <div className="ctx-pop-head">{headline}</div>
          <div className="ctx-pop-model muted">{usage.model}{usage.window === null ? " · window size unknown" : ""}</div>
          <div className="ctx-parts">
            {PARTS.filter((p) => usage.breakdown[p.key] > 0).map((p) => (
              <div key={p.key} className="ctx-part">
                <span className="ctx-part-label">{p.label}</span>
                <span className="ctx-part-bar"><span style={{ width: `${(usage.breakdown[p.key] / sum) * 100}%` }} /></span>
                <span className="ctx-part-n">{kTokens(usage.breakdown[p.key])}</span>
              </div>
            ))}
          </div>
          {usage.cacheReadTokens !== undefined && (
            <div className={`ctx-pop-note${cacheShare < 20 && usage.inputTokens > 4000 ? " warn" : ""}`}>
              {cacheShare > 0 ? `Prompt cache: ${kTokens(usage.cacheReadTokens)} read (${cacheShare}% of the input).` : "Prompt cache missed: this call paid for every input token."}
            </div>
          )}
          {pack && pack.items.length > 0 && (
            <div className="ctx-pop-note muted">This message's context pack: {pack.items.length} file{pack.items.length === 1 ? "" : "s"}, {kTokens(pack.used)} of a {kTokens(pack.budget)} budget{pack.path === "quick" ? " (fast ranking: the full one ran past its time budget)" : ""}.</div>
          )}
        </div>
      )}
    </div>
  );
});
