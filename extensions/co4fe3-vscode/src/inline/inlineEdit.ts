import * as vscode from "vscode";
import type { EditorHost, Proposal, Problem, Decision, ApplyResult, FileEntry } from "@co4fe3/agent-core";
import { jail, splitLines, toHunks, extractFence, streamingPreview, assembleInline, buildInlinePrompt, PhaseBox, pickProblems, newErrors, BUDGET, Marks, type InlinePhase } from "@co4fe3/agent-core";
import type { ReviewController } from "../review/controller.js";
import type { Router } from "../forge/router.js";
import type { SessionPool } from "../forge/sessions.js";

export interface InlineDeps {
  host: EditorHost;
  review: ReviewController;
  sessions: SessionPool;
  router: Router;
  status: { inline(p: InlinePhase): void; setTtft(ms: number, model: string): void };
  applyDecision: (p: Proposal, d: Decision) => Promise<ApplyResult>;
  toastApplied: (p: Proposal, d: Decision, fresh: Problem[]) => void;
  index(): { byPath: Map<string, FileEntry> } | null;
  out: vscode.LogOutputChannel;
}

let activeCancel: AbortController | null = null;

/** Selection → whole lines. Empty selection → the enclosing def/class, else the current line. */
export function targetLines(ed: vscode.TextEditor): { start: number; end: number } {
  const sel = ed.selection;
  const lines = ed.document.getText().split("\n");
  const at = sel.isEmpty ? sel.active.line : sel.end.line;
  if (!sel.isEmpty) return { start: sel.start.line, end: sel.end.line };
  const isDef = (l: string): boolean => /^(?:\s*)(?:async\s+)?(?:def|class|function)\s/.test(l);
  let start = at;
  if (!isDef(lines[at] ?? "")) {
    for (let i = at; i >= 0; i--) if (isDef(lines[i] ?? "")) { start = i; break; }
  }
  const indent = (l: string): number => l.length - l.trimStart().length;
  const base = indent(lines[start] ?? "");
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "") continue;
    if (indent(lines[i]!) <= base) break;
    end = i;
  }
  return { start, end };
}

export function registerInlineEdit(ctx: vscode.ExtensionContext, d: InlineDeps): void {
  ctx.subscriptions.push(vscode.commands.registerCommand("co4fe3.inlineEdit", async (opts?: { instruction?: string }) => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const t0 = performance.now();
    const marks = new Marks(); marks.mark("enter");
    const { start, end } = targetLines(ed);                     // selection → whole lines; empty → enclosing def/class, else the current line
    const firstModel = d.router.order("inline")[0];
    if (firstModel) d.sessions.warm("inline", firstModel);      // pre-warm while the user types (rule 60, lever 3)
    const instruction = opts?.instruction ?? await vscode.window.showInputBox({ title: `co4fe3 · edit lines ${start + 1}-${end + 1}`, prompt: `Model: ${d.router.label("inline")}`, placeHolder: "Describe the change", ignoreFocusOut: true });
    if (!instruction?.trim()) return;
    const rel = jail(d.host.root, vscode.workspace.asRelativePath(ed.document.uri, false));
    const before = ed.document.getText();
    const version = ed.document.version;                            // sourceChanged detection (V3Code turboDraftRunState)
    const phase = new PhaseBox("reading", (p) => d.status.inline(p)); // throws on an illegal move (canAdvance): a bug, not a user error
    const key = `inline-${Date.now().toString(36)}`;
    const original = splitLines(before).slice(start, end + 1).join("");
    const ac = new AbortController();
    activeCancel = ac;
    await vscode.commands.executeCommand("setContext", "co4fe3.inlineBusy", true);
    try {
      await d.review.showStreaming(rel, key, before);                // opens the diff right away (the right side starts equal to the file)
      const entry = d.index()?.byPath.get(rel);                     // FileEntry, or undefined while the index builds
      const outline = entry ? entry.syms.map((s) => `L${s.line} ${s.sig}`).join("\n") : "";
      const baseline = await d.host.problems(rel);                 // compiler truth for the prompt AND the verify baseline
      const near = baseline.filter((p) => p.line >= start - 60 && p.line <= end + 60);
      const prompt = buildInlinePrompt({ path: rel, lang: ed.document.languageId, instruction, text: before, start, end, outline, problems: pickProblems(near), budget: BUDGET.inline });
      phase.to("drafting");
      let acc = "", lastPaint = 0;
      const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "co4fe3", cancellable: true }, async (progress, token) => {
        token.onCancellationRequested(() => ac.abort());
        return d.router.inline(prompt, {
          onStatus: (s) => progress.report({ message: s }),        // "Waiting for nvidia-nim/nemotron-super… 2 s"
          onText: (full) => {                                      // the leader's text so far (rule 60: the UI follows one leader)
            marks.mark("firstDelta"); acc = full;
            d.status.setTtft(Math.round(performance.now() - t0), d.router.lastModel());
            const f = extractFence(acc, false);
            if (f && performance.now() - lastPaint > 50) { lastPaint = performance.now(); d.review.preview(rel, key, assembleInline(before, start, end, streamingPreview(original, f.code))); }
          },
        }, ac.signal);
      });
      marks.mark("done");
      const finish = (p: InlinePhase, msg: string) => { phase.to(p); d.review.closeStreaming(rel, key, msg); };
      if (res.status !== "done") return void finish(res.status === "cancelled" ? "cancelled" : "error", res.status === "cancelled" ? "Cancelled. Nothing was changed." : res.message);
      if (ed.document.version !== version) return void finish("sourceChanged", "The file changed while drafting. Nothing was changed; run the edit again.");
      const f = extractFence(res.output, true);
      if (!f?.code.trim()) return void finish("error", "The model returned no code. Nothing was changed.");
      const after = assembleInline(before, start, end, f.code);
      if (after === before) return void finish("noChanges", "The model proposed no change.");
      const hunks = toHunks(before, after);
      const proposal: Proposal = { key, turnId: key, threadId: "main", toolCallId: key, by: "inline", path: rel, why: instruction, before, after, hunks, verdict: Object.fromEntries(hunks.map((h) => [h.id, "pending" as const])), baseline };
      marks.mark("review"); phase.to("reviewing");
      const decision = await d.review.review(proposal, ac.signal, { focus: true });   // the same per-hunk review as agent mode
      if (decision.accepted.length) {
        const tApply = d.host.now();
        await d.applyDecision(proposal, decision);                                   // → Applier.apply → checkpoint
        const fresh = newErrors(baseline, await d.host.problems(rel, { changedSince: tApply, waitMs: 1500 }));   // verify (rule 30)
        d.toastApplied(proposal, decision, fresh);    // "Applied 1 of 2 hunks · No new errors · Undo" or "… · 1 new error: line 41 … · Undo"
        phase.to("applied");
      } else phase.to("cancelled");                    // all rejected: nothing written
      d.out.info(marks.line(d.router.lastModel()));
    } finally {
      activeCancel = null;
      await vscode.commands.executeCommand("setContext", "co4fe3.inlineBusy", false);
    }
  }));
  ctx.subscriptions.push(vscode.commands.registerCommand("co4fe3.inlineCancel", () => { activeCancel?.abort(); }));
}
