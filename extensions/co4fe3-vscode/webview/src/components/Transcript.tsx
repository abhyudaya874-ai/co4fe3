import { memo } from "react";
import type { PanelState, Row } from "@co4fe3/agent-core/panel";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { Icon, Spinner } from "./Icon.js";
import { DiffCard } from "./DiffCard.js";
import { PlanCard } from "./PlanCard.js";
import { UserBubble, AssistantText, ToolRow, MemberRow, MessageBubble, PackCard, BoardCard, CommandCard, ModelBanner, Marker, LatencyLine, InstructionsLine } from "./rows.js";

function renderRow(row: Row, live: boolean, busy: boolean) {
  const e = row.e;
  switch (e.kind) {
    case "user": return <UserBubble e={e} />;
    case "text": return <AssistantText e={e} live={live} />;
    case "tool": return <ToolRow e={e} />;
    case "member": return <MemberRow e={e} />;
    case "message": return <MessageBubble e={e} />;
    case "pack": return <PackCard e={e} />;
    case "proposal": return <DiffCard e={e} />;
    case "command": return <CommandCard e={e} />;
    case "marker": return <Marker e={e} />;
    case "board": return <BoardCard entries={e.entries} />;
    case "plan": return <PlanCard e={e} busy={busy} />;
    case "model": return <ModelBanner e={e} />;
    case "latency": return <LatencyLine e={e} />;
    case "instructions": return <InstructionsLine e={e} />;
    case "status": case "usage": return null;                                          // the status lives outside the row order
  }
}

/** What the run is doing now, at the end of the transcript. */
function RunStatus({ s }: { s: PanelState }) {
  const st = s.status;
  if (!st) return null;
  if (st.state === "running") return <div className="run-status"><Spinner size={13} /><span>Working</span></div>;
  if (st.state === "paused") return <div className="run-status wait"><Icon name="clock" size={13} /><span>Waiting for your review</span></div>;
  if (st.state === "stopping") return <div className="run-status"><Spinner size={13} /><span>Stopping</span></div>;
  if (st.state === "cancelled") return <div className="run-status muted"><Icon name="stop" size={11} /><span>Stopped{st.message && st.message !== "client-cancelled" ? ` (${st.message})` : ""}</span></div>;
  if (st.state === "error") return <div className="banner error" role="alert"><Icon name="alert" size={14} /><span>{st.message ?? "The request failed."}</span></div>;
  return null;
}

/** The conversation, in order. Rows are memo'd, and a render error costs one row, never the view. */
export const Transcript = memo(function Transcript({ s, busy }: { s: PanelState; busy: boolean }) {
  const last = s.order.at(-1)?.id;
  return (
    <div className="transcript">
      {s.order.map((row) => (
        <ErrorBoundary key={row.id} scope="row" label={row.k}>
          {renderRow(row, busy && row.id === last, busy)}
        </ErrorBoundary>
      ))}
      <BoardCard entries={s.board} />
      <RunStatus s={s} />
    </div>
  );
});
