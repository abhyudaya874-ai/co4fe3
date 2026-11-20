import { memo, useState, type ReactNode } from "react";
import type { PanelEvent, HunkView } from "@co4fe3/agent-core/panel";
import { useActions } from "../actions.js";
import { hunkDeltas, hunkLines, splitPath } from "../format.js";
import { Icon, Spinner } from "./Icon.js";

type Proposal = Extract<PanelEvent, { kind: "proposal" }>;
const COLLAPSE_AT = 40;                                                // lines a hunk shows before "Show more"

function Hunk({ e, h, delta, index }: { e: Proposal; h: HunkView; delta: number; index: number }) {
  const { decide } = useActions();
  const [more, setMore] = useState(false);
  const verdict = e.verdict[h.id] ?? "pending";
  const lines = hunkLines(h, delta);
  const shown = more ? lines : lines.slice(0, COLLAPSE_AT);
  const settled = !!e.applied || !!e.dropped;
  return (
    <div className={`hunk ${verdict}`}>
      <div className="hunk-head">
        <span className="hunk-title">{e.hunks.length > 1 ? `Change ${index + 1} of ${e.hunks.length}` : "Change"} · line {h.oldStart + 1}</span>
        <span className="spacer" />
        {verdict === "pending" && !settled && (
          <>
            <button type="button" className="btn small" onClick={() => decide(e.key, h.id, "rejected")} title="Reject this change">Reject</button>
            <button type="button" className="btn small primary" onClick={() => decide(e.key, h.id, "accepted")} title="Accept this change">Accept</button>
          </>
        )}
        {verdict === "accepted" && <span className="verdict ok"><Icon name="check" size={12} />Accepted</span>}
        {verdict === "rejected" && <span className="verdict no"><Icon name="x" size={12} />Rejected</span>}
      </div>
      <div className="hunk-lines" role="table" aria-label="Changed lines">
        {shown.map((l, i) => (
          <div key={i} className={`dl ${l.kind}`} role="row">
            <span className="dl-no">{l.kind === "add" ? "" : l.oldNo}</span>
            <span className="dl-no">{l.kind === "del" ? "" : l.newNo}</span>
            <span className="dl-sign" aria-hidden="true">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}</span>
            <span className="dl-text">{l.text === "" ? " " : l.text}</span>
          </div>
        ))}
      </div>
      {lines.length > COLLAPSE_AT && (
        <button type="button" className="link-btn hunk-more" onClick={() => setMore(!more)}>{more ? "Show less" : `Show ${lines.length - COLLAPSE_AT} more lines`}</button>
      )}
      {!!h.hidden && <div className="muted hunk-hidden">…{h.hidden} more lines in this change. Open the diff to see all of it.</div>}
    </div>
  );
}

/** A proposed edit as a card: the file, +N −M, every change with red and green lines, and the verdict controls. */
export const DiffCard = memo(function DiffCard({ e }: { e: Proposal }) {
  const { decideAll, openDiff, openFile, undo } = useActions();
  const [folded, setFolded] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const { dir, base } = splitPath(e.path);
  const deltas = hunkDeltas(e.hunks);
  const pending = e.hunks.filter((h) => e.verdict[h.id] === "pending").length;
  const accepted = e.hunks.filter((h) => e.verdict[h.id] === "accepted").length;
  const rejected = e.hunks.length - pending - accepted;
  const settled = !!e.applied || !!e.dropped;

  let foot: ReactNode = null;
  if (e.dropped) foot = <span className="foot-note muted"><Icon name="alert" size={12} />Not applied. The request ended before this was reviewed.</span>;
  else if (e.applied?.undone) foot = <span className="foot-note muted"><Icon name="undo" size={12} />Undone. The file is back to how it was.</span>;
  else if (e.applied) {
    foot = (
      <>
        <span className="foot-note ok"><Icon name="check" size={12} />Applied {accepted} of {e.hunks.length} change{e.hunks.length === 1 ? "" : "s"}{e.applied.newErrors.length ? "" : " · no new errors"}</span>
        <span className="spacer" />
        <button type="button" className="btn small" disabled={undoing} onClick={() => { setUndoing(true); undo(e.applied!.checkpointId); }}><Icon name="undo" size={12} />Undo</button>
      </>
    );
  } else if (pending > 0) {
    foot = (
      <>
        <span className="foot-note muted">{pending} change{pending === 1 ? "" : "s"} waiting for your review</span>
        <span className="spacer" />
        <button type="button" className="btn small" onClick={() => decideAll(e.key, "rejected")}>Reject all</button>
        <button type="button" className="btn small primary" onClick={() => decideAll(e.key, "accepted")}>Accept all</button>
      </>
    );
  } else if (accepted === 0) foot = <span className="foot-note muted"><Icon name="x" size={12} />Rejected. Nothing was written.</span>;
  else foot = <span className="foot-note muted"><Spinner size={12} />Applying {accepted} change{accepted === 1 ? "" : "s"}…</span>;

  return (
    <div className={`diff${e.dropped ? " dropped" : ""}`}>
      <div className="diff-head">
        <button type="button" className="icon-btn" onClick={() => setFolded(!folded)} aria-expanded={!folded} aria-label={folded ? "Show changes" : "Hide changes"}>
          <Icon name={folded ? "chevronRight" : "chevronDown"} size={13} />
        </button>
        <span className="tool-ic"><Icon name="edit" size={13} /></span>
        <button type="button" className="diff-file" onClick={() => openFile(e.path)} title={`Open ${e.path}`}>
          <span className="diff-dir"><bdi>{dir}</bdi></span><span className="diff-base">{base}</span>
        </button>
        <span className="diff-stat"><span className="add">+{e.adds}</span><span className="del">−{e.removes}</span></span>
        <span className="spacer" />
        <button type="button" className="btn small ghost" onClick={() => openDiff(e.key)} disabled={settled && !e.applied} title="Open in the side-by-side diff editor">Open diff</button>
      </div>
      {e.why && <div className="diff-why">{e.why}{e.by && e.by !== "lead" ? <span className="muted"> · {e.by}</span> : null}</div>}
      {!folded && <div className="diff-body">{e.hunks.map((h, i) => <Hunk key={h.id} e={e} h={h} delta={deltas[i] ?? 0} index={i} />)}</div>}
      {rejected > 0 && pending === 0 && accepted > 0 && !settled && <div className="muted diff-partial">{rejected} change{rejected === 1 ? "" : "s"} rejected</div>}
      {e.applied && e.applied.newErrors.length > 0 && !e.applied.undone && (
        <div className="diff-errors" role="status"><Icon name="alert" size={13} /><div>New errors after this edit:{e.applied.newErrors.map((m, i) => <div key={i} className="mono">{m}</div>)}</div></div>
      )}
      <div className="diff-foot">{foot}</div>
    </div>
  );
});
