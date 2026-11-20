import * as vscode from "vscode";
import type { EditorHost, Proposal, Problem, Decision, ApplyResult, FileEntry } from "@co4fe3/agent-core";
import { jail, splitLines, selectedLines, toHunks, extractFence, streamingPreview, assembleInline, buildInlinePrompt, PhaseBox, pickProblems, newErrors, BUDGET, Marks, fallbackBanner, type Failure, type Note, type InlinePhase } from "@co4fe3/agent-core";
import type { ReviewController } from "../review/controller.js";
import type { Router } from "../forge/router.js";
import type { SessionPool } from "../forge/sessions.js";
import { InlineWidget, ThreadView } from "./inlineThread.js";

export interface InlineDeps {
  host: EditorHost;
  review: ReviewController;
  sessions: SessionPool;
  router: Router;
  status: { inline(p: InlinePhase): void; setTtft(ms: number, model: string): void };
  cfg(): { trueforge: { url: string }; latency: { hedgeInline: boolean } };
  applyDecision: (p: Proposal, d: Decision) => Promise<ApplyResult>;
  toastApplied: (p: Proposal, d: Decision, fresh: Problem[]) => void;
  index(): { byPath: Map<string, FileEntry> } | null;
  /** The model menu (the widget's model button). */
  pickModel(): Thenable<unknown>;
  out: vscode.LogOutputChannel;
}

/** The run in progress: Stop/Esc aborts it, and a review in the widget decides through it. */
let current: { ac: AbortController; key: string; view: ThreadView | null } | null = null;

/** Selection → whole lines. Empty selection → the enclosing def/class, else the current line. */
export function targetLines(ed: vscode.TextEditor): { start: number; end: number } {
  const sel = ed.selection;
  const lines = ed.document.getText().split("\n");
  const at = sel.isEmpty ? sel.active.line : sel.end.line;
  if (!sel.isEmpty) return selectedLines(sel);
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

/** Where one run shows its draft and its review. The pipeline below is the same for both. */
interface Surface {
  /** The run starts: show that something is happening. */
  begin(): Promise<void>;
  /** The model's code so far, whole lines of the replacement. */
  preview(code: string): void;
  /** The run ended without a review (cancelled, failed, no change). `msg` is shown to the user. */
  close(msg: string): void;
  /** Show `p` for review; resolves when every change is decided. */
  review(p: Proposal, signal: AbortSignal): Promise<Decision>;
  /** The review is done (accepted, rejected, or the run ended). */
  done(): void;
}

interface Job { doc: vscode.TextDocument; start: number; end: number; instruction: string }

export function registerInlineEdit(ctx: vscode.ExtensionContext, d: InlineDeps): void {
  const widget = new InlineWidget({ placeholder: () => `Enter instruction (${(d.router.label("inline").split("/").at(-1)) ?? "model"})` });
  ctx.subscriptions.push(widget);

  /** One edit, end to end: prompt → stream → hunks → review → apply → verify. */
  async function run(job: Job, mkSurface: (ctx: { rel: string; key: string; before: string; start: number; end: number; original: string; ac: AbortController }) => Surface): Promise<void> {
    if (current) return void vscode.window.showInformationMessage("An inline edit is already running. Stop it first (Esc).");
    const { doc, start, end, instruction } = job;
    const t0 = performance.now();
    const marks = new Marks(); marks.mark("enter");
    const rel = jail(d.host.root, vscode.workspace.asRelativePath(doc.uri, false));
    const before = doc.getText();
    const version = doc.version;                                    // sourceChanged detection (V3Code turboDraftRunState)
    const phase = new PhaseBox("reading", (p) => d.status.inline(p)); // throws on an illegal move (canAdvance): a bug, not a user error
    const key = `inline-${Date.now().toString(36)}`;
    const original = splitLines(before).slice(start, end + 1).join("");
    const ac = new AbortController();
    const ui = mkSurface({ rel, key, before, start, end, original, ac });
    current = { ac, key, view: null };
    await vscode.commands.executeCommand("setContext", "co4fe3.inlineBusy", true);
    try {
      await ui.begin();                                             // opens the diff (or labels the thread) right away
      const entry = d.index()?.byPath.get(rel);                     // FileEntry, or undefined while the index builds
      const outline = entry ? entry.syms.map((sym) => `L${sym.line} ${sym.sig}`).join("\n") : "";
      const baseline = await d.host.problems(rel);                 // compiler truth for the prompt AND the verify baseline
      const near = baseline.filter((p) => p.line >= start - 60 && p.line <= end + 60);
      const prompt = buildInlinePrompt({ path: rel, lang: doc.languageId, instruction, text: before, start, end, outline, problems: pickProblems(near), budget: BUDGET.inline });
      phase.to("drafting");
      let acc = "", lastPaint = 0;
      let firstFail: { model: string; failure: Failure } | null = null;
      const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "co4fe3", cancellable: true }, async (progress, token) => {
        token.onCancellationRequested(() => ac.abort());
        return d.router.inline(prompt, {
          onStatus: (st) => progress.report({ message: st }),      // "Waiting for nvidia-nim/nemotron-super… 2 s"
          onText: (full) => {                                      // the leader's text so far (rule 60: the UI follows one leader)
            marks.mark("firstDelta"); acc = full;
            d.status.setTtft(Math.round(performance.now() - t0), d.router.lastModel());
            const f = extractFence(acc, false);
            if (f && performance.now() - lastPaint > 80) { lastPaint = performance.now(); ui.preview(f.code); }
          },
          onNote: (n: Note) => {
            if (n.kind === "failed" && !firstFail) firstFail = { model: n.model, failure: n.failure };
            if (n.kind === "answered" && n.fellBack && firstFail)
              void vscode.window.showWarningMessage(fallbackBanner(firstFail.model, firstFail.failure, n.model));   // rule 70: names the failure + who answered
          },
        }, ac.signal);
      });
      marks.mark("done");
      const finish = (p: InlinePhase, msg: string) => { phase.to(p); ui.close(msg); };
      if (res.status !== "done") {
        if (res.status === "cancelled") return void finish("cancelled", "Cancelled. Nothing was changed.");
        finish("error", res.message ?? "The edit failed.");
        if (res.message?.includes("No configured model answered")) {          // rule 70: every model failed — offer the two doors
          const pick = await vscode.window.showErrorMessage(res.message, "Retry", "Open TrueForge settings");
          if (pick === "Retry") void vscode.commands.executeCommand("co4fe3.inlineEdit");
          else if (pick === "Open TrueForge settings") void vscode.env.openExternal(vscode.Uri.parse(d.cfg().trueforge.url));
        }
        return;
      }
      if (doc.version !== version) return void finish("sourceChanged", "The file changed while drafting. Nothing was changed; run the edit again.");
      const f = extractFence(res.output, true);
      if (!f?.code.trim()) return void finish("error", "The model returned no code. Nothing was changed.");
      const after = assembleInline(before, start, end, f.code);
      if (after === before) return void finish("noChanges", "The model proposed no change.");
      const hunks = toHunks(before, after);
      const proposal: Proposal = { key, turnId: key, threadId: "main", toolCallId: key, by: "inline", path: rel, why: instruction, before, after, hunks, verdict: Object.fromEntries(hunks.map((h) => [h.id, "pending" as const])), baseline };
      marks.mark("review"); phase.to("reviewing");
      const decision = await ui.review(proposal, ac.signal);        // the same per-hunk review as agent mode
      if (decision.accepted.length) {
        const tApply = d.host.now();
        await d.applyDecision(proposal, decision);                                   // → Applier.apply → checkpoint
        const fresh = newErrors(baseline, await d.host.problems(rel, { changedSince: tApply, waitMs: 1500 }));   // verify (rule 30)
        d.toastApplied(proposal, decision, fresh);    // "Applied 1 of 2 hunks · No new errors · Undo" or "… · 1 new error: line 41 … · Undo"
        phase.to("applied");
      } else phase.to("cancelled");                    // all rejected: nothing written
      d.out.info(marks.line(d.router.lastModel()));
    } catch (e) {
      if (!ac.signal.aborted) throw e;                                // Stop or the widget's close: not an error
      try { phase.to("cancelled"); } catch { /* already terminal */ }
    } finally {
      ui.done();
      current = null;
      await vscode.commands.executeCommand("setContext", "co4fe3.inlineBusy", false);
    }
  }

  // ── surface 1: the diff tab (programmatic calls and the e2e test) ─────────────
  const tabSurface: Parameters<typeof run>[1] = (c) => ({
    begin: () => d.review.showStreaming(c.rel, c.key, c.before),    // opens the diff right away (the right side starts equal to the file)
    preview: (code) => d.review.preview(c.rel, c.key, assembleInline(c.before, c.start, c.end, streamingPreview(c.original, code))),
    close: (msg) => d.review.closeStreaming(c.rel, c.key, msg),
    review: (p, signal) => d.review.review(p, signal, { focus: true }),
    done: () => undefined,
  });

  // ── surface 2: the comment widget over the selected lines ─────────────────────
  const threadSurface = (thread: vscode.CommentThread, lang: string): Parameters<typeof run>[1] => (c) => {
    const view = new ThreadView(thread, lang);
    view.label(`${d.router.label("inline").split("/").at(-1) ?? "model"} · lines ${c.start + 1}-${c.end + 1}`);
    let off: (() => void) | null = null;
    return {
      begin: async () => { if (current) current.view = view; view.preview(""); },
      preview: (code) => view.preview(code),
      close: (msg) => { view.dispose(); void vscode.window.showInformationMessage(msg); },
      review: (p, signal) => {
        view.show(p);
        off = d.review.store.onChange((k) => { if (k !== c.key) return; const cur = d.review.store.get(k); if (cur) view.update(cur); });
        return d.review.review(p, signal, { open: false });          // staged in the store; the buttons below decide
      },
      done: () => { off?.(); view.dispose(); },
    };
  };

  const decide = (arg: unknown, v: "accepted" | "rejected"): void => {
    if (!current?.view) return;
    const id = current.view.hunkOf(arg);
    if (!id) return void d.out.info("inline: a button press did not name a change; ignored");
    d.review.store.decide(current.key, id, v);
  };
  const decideAll = (v: "accepted" | "rejected"): void => { if (current?.view) d.review.store.decideAll(current.key, v); };

  ctx.subscriptions.push(
    vscode.commands.registerCommand("co4fe3.inlineEdit", async (opts?: { instruction?: string }) => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      const { start, end } = targetLines(ed);                     // selection → whole lines; empty → enclosing def/class, else the current line
      const order = d.router.order("inline");
      for (const m of order.slice(0, d.cfg().latency.hedgeInline ? 2 : 1)) d.sessions.warm("inline", m);   // pre-warm while the user types (rule 60, lever 3)
      if (opts?.instruction !== undefined) return await run({ doc: ed.document, start, end, instruction: opts.instruction }, tabSurface);
      if (current) return void vscode.window.showInformationMessage("An inline edit is already running. Stop it first (Esc).");
      await widget.open(ed, start, end);                          // the editor's own comment box, over the lines, cursor inside
    }),
    // The box's own "Submit" button: the thread and the typed instruction arrive as a CommentReply.
    vscode.commands.registerCommand("co4fe3.inline.submit", async (reply: vscode.CommentReply) => {
      const instruction = reply.text.trim();
      if (!instruction) return;
      widget.disarm();
      const doc = await vscode.workspace.openTextDocument(reply.thread.uri);
      const r = reply.thread.range;
      const ed = vscode.window.visibleTextEditors.find((e) => e.document === doc);
      const lines = r ? { start: r.start.line, end: r.end.line } : ed ? targetLines(ed) : { start: 0, end: 0 };
      await run({ doc, start: lines.start, end: lines.end, instruction }, threadSurface(reply.thread, doc.languageId));
    }),
    vscode.commands.registerCommand("co4fe3.inline.model", async () => { await d.pickModel(); widget.setPlaceholder(); }),
    vscode.commands.registerCommand("co4fe3.inline.hunkAccept", (c: unknown) => decide(c, "accepted")),
    vscode.commands.registerCommand("co4fe3.inline.hunkReject", (c: unknown) => decide(c, "rejected")),
    vscode.commands.registerCommand("co4fe3.inline.acceptAll", () => decideAll("accepted")),
    vscode.commands.registerCommand("co4fe3.inline.rejectAll", () => decideAll("rejected")),
    // The thread's close button, and Esc while a run is busy.
    vscode.commands.registerCommand("co4fe3.inline.close", (t?: vscode.CommentThread) => { if (current) current.ac.abort(); else { widget.disarm(); t?.dispose(); } }),
    vscode.commands.registerCommand("co4fe3.inlineCancel", () => { current?.ac.abort(); }),
  );
}
