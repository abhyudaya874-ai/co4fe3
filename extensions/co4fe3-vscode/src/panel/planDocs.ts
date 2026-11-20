import * as vscode from "vscode";
import { planRowId, type Hub, type PanelEvent } from "@co4fe3/agent-core/panel";

type Plan = Extract<PanelEvent, { kind: "plan" }>;

// Plans live in the transcript, never in the workspace (law 3): "Open" shows them as a read-only virtual document.
export const PLAN_SCHEME = "co4fe3-plan";
export const planUri = (id: string): vscode.Uri => vscode.Uri.from({ scheme: PLAN_SCHEME, path: `/plan-${id}.md`, query: `id=${encodeURIComponent(id)}` });
export const planMarkdown = (p: Pick<Plan, "title" | "summary" | "body">): string => `# ${p.title}\n\n${p.summary}\n\n${p.body.trim()}\n`;

/** The plan card with this id, from the active transcript. */
export const findPlan = (hub: Hub, id: string): Plan | undefined => {
  const e = hub.panel.byId[planRowId(id)]?.e;
  return e?.kind === "plan" ? e : undefined;
};

/** What Accept sends to the Code-mode turn: the whole plan, so the turn does not depend on the model recalling it. */
export const implementPlanMessage = (p: Plan): string =>
  `The user accepted this plan. Implement it now, step by step: make each change with propose_edit and verify it the way the step says.\n\n${planMarkdown(p)}`;

export function registerPlanDocs(hub: Hub): vscode.Disposable {
  return vscode.workspace.registerTextDocumentContentProvider(PLAN_SCHEME, {
    provideTextDocumentContent: (uri) => {
      const p = findPlan(hub, new URLSearchParams(uri.query).get("id") ?? "");
      return p ? planMarkdown(p) : "This plan is not in the open session.\n";
    },
  });
}
