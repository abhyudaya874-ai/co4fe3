import { memo } from "react";
import type { PanelEvent } from "@co4fe3/agent-core/panel";
import { md } from "../md.js";
import { useActions } from "../actions.js";
import { Icon } from "./Icon.js";

type Plan = Extract<PanelEvent, { kind: "plan" }>;

/** Plan mode's result, as Devin shows it: the plan file, its title and summary, the steps, then Accept or Reject. */
export const PlanCard = memo(function PlanCard({ e, busy }: { e: Plan; busy: boolean }) {
  const { plan, openPlan, openFile } = useActions();
  const proposed = e.state === "proposed";
  return (
    <div className={`plan ${e.state}`}>
      <div className="plan-head">
        <Icon name="file" size={13} />
        <span className="plan-file">plan-{e.id}.md</span>
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={() => openPlan(e.id)} title="Open the plan as a markdown document">Open</button>
      </div>
      <div className="plan-title">{e.title}</div>
      <div className="plan-summary muted">{e.summary}</div>
      <details className="plan-body" open={proposed}>
        <summary>Steps</summary>
        <div className="md">{md(e.body, { onFile: openFile })}</div>
      </details>
      {proposed && (
        <div className="plan-ask">
          <span className="muted">{busy ? "Waiting for the turn to finish…" : "Implement this plan in Code mode?"}</span>
          <button type="button" className="btn" disabled={busy} onClick={() => plan(e.id, "reject")}>Reject</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => plan(e.id, "accept")}>Accept</button>
        </div>
      )}
      {e.state === "accepted" && <div className="plan-end ok"><Icon name="check" size={12} /><span>Accepted. Implementing in Code mode; every edit still comes to you for review.</span></div>}
      {e.state === "rejected" && <div className="plan-end muted"><Icon name="x" size={12} /><span>Rejected. Say what to change and Plan mode writes a new plan.</span></div>}
    </div>
  );
});
