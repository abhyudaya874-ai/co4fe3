import { describe, it, expect } from "vitest";
import { renderToString as ssr } from "react-dom/server";
import type { ReactNode } from "react";
import { applyPanelBatch, emptyPanel, emptyChrome, type PanelEvent, type ModelRow, type CompletionItem } from "@co4fe3/agent-core/panel";
import { Transcript } from "../src/components/Transcript.js";
import { Composer } from "../src/components/Composer.js";
import { Sidebar } from "../src/components/Sidebar.js";
import { ReviewBar } from "../src/components/ReviewBar.js";
import { Empty } from "../src/components/Empty.js";
import { ModeMenu, ModelMenu } from "../src/components/menus.js";
import { ErrorBoundary } from "../src/components/ErrorBoundary.js";
import { ActionsContext, NO_ACTIONS } from "../src/actions.js";
import { md } from "../src/md.js";

// The chat once went blank because ONE value in ONE card made React throw (error #62), and nothing rendered the cards in a test.
// Every PanelEvent kind has a fixture here, and the table is typed so a new kind cannot be added without one.
const pack = { items: [{ path: "src/flask/app.py", tokens: 420, pinned: true, why: ["mentioned", "#1 lexical"], text: "", mode: "outline" as const }], skipped: [{ path: "x.py", why: "over budget" }], used: 4642, budget: 6000, path: "full" as const };
const FIXTURES: { [K in PanelEvent["kind"]]: Extract<PanelEvent, { kind: K }> } = {
  user: { kind: "user", turnId: "t1", text: "Add a flag", attach: { path: "src/a.py", start: 3, end: 9 } },
  text: { kind: "text", id: "m1", threadId: "main", text: "I'll **start** with `src/flask/app.py:12`.\n\n- one\n- two\n\n```python\nprint(1)\n```", reasoning: "thinking about it" },
  tool: { kind: "tool", id: "c1", threadId: "main", name: "read_file", args: '{"path":"src/a.py","offset":10,"limit":20}', state: "ok", result: "text" },
  member: { kind: "member", threadId: "th1", title: "scout", profile: "research", status: "running" },
  message: { kind: "message", id: "to-th1", from: "main", to: "scout", text: "PROFILE: research\nfind the tests\nreport under 15 lines\nthanks" },
  pack: { kind: "pack", pack, turnId: "t1" },
  instructions: { kind: "instructions", inline: ["AGENTS.md"], onDemand: 2, activeSkills: ["review"], turnId: "t1" },
  proposal: { kind: "proposal", key: "k1", path: "src/flask/helpers.py", why: "shout", by: "lead", adds: 2, removes: 1, hunks: [
    { id: "h1", oldStart: 27, oldLines: ["def a():"], newLines: ["def a(x):", "    pass"], before: ["", "x = 1"], after: ["    return 1"] },
    { id: "h2", oldStart: 40, oldLines: [], newLines: ["# end"], before: [], after: [], hidden: 3 },
  ], verdict: { h1: "accepted", h2: "pending" }, applied: undefined },
  command: { kind: "command", id: "cmd-1", command: "pytest -q", state: "asking", output: "ok", exit: 0 },
  board: { kind: "board", entries: [{ key: "api.name", value: "Flask", by: "scout", at: 1 }] },
  plan: { kind: "plan", id: "t1", turnId: "t1", title: "Doc comment for TracebackType (app.py:10)", summary: "Add a one-line comment above the import.", body: "1. `src/flask/app.py:10`: add the comment.\n2. Verify with `python -c 'import flask'`.", state: "proposed" },
  marker: { kind: "marker", id: "m", text: "context compacted" },
  model: { kind: "model", note: { kind: "failed", model: "nvidia-nim/nemotron-super", failure: { kind: "auth", benchMs: 600000, retrySame: false, detail: "HTTP 403: Forbidden" }, next: "google-gemini/gemini-flash-lite" } },
  latency: { kind: "latency", line: "perf ttft=689 total=8130 model=nvidia-nim/nemotron-super" },
  status: { kind: "status", state: "error", message: "boom" },
  usage: { kind: "usage", turnId: "t1", model: "nvidia-nim/nemotron-super", inputTokens: 46_000, outputTokens: 400, cacheReadTokens: 30_000, window: 262_144, breakdown: { harness: 900, instructions: 5200, messages: 36_000, skills: 300, toolDefinitions: 3600 } },
};

/** Server rendering separates adjacent text nodes with comments; the text a person reads has none. */
const renderToString = (n: ReactNode): string => ssr(n).replace(/<!-- -->/g, "");
const Wrap = ({ children }: { children: ReactNode }) => <ActionsContext.Provider value={NO_ACTIONS}>{children}</ActionsContext.Provider>;
const view = (events: PanelEvent[], busy = false): string => renderToString(<Wrap><Transcript s={applyPanelBatch(emptyPanel(), events)} busy={busy} /></Wrap>);

describe("the transcript renders every kind of event", () => {
  for (const [kind, e] of Object.entries(FIXTURES)) {
    it(`${kind}`, () => { expect(() => view([e])).not.toThrow(); });
  }
  it("all of them together, idle and busy", () => {
    const all = Object.values(FIXTURES);
    expect(() => view(all)).not.toThrow();
    expect(() => view(all, true)).not.toThrow();
  });
  it("an empty transcript", () => { expect(view([])).toContain("transcript"); });
});

describe("what the cards say", () => {
  it("the context card draws its bar with an object style (the string style was the crash)", () => {
    const html = view([FIXTURES.pack]);
    expect(html).toContain("Context · 1 file");
    expect(html).toMatch(/class="ctx-fill" style="width:77\.\d+%"/);
  });
  it("a tool row names its target; a command's own card replaces the run_command row", () => {
    expect(view([FIXTURES.tool])).toContain("src/a.py:10-29");
    const run = view([{ kind: "tool", id: "c2", threadId: "main", name: "run_command", args: '{"command":"ls"}', state: "running" }]);
    expect(run).not.toContain("tool-head");
  });
  it("the diff card shows red and green lines with numbers, per-change buttons while pending, and the file", () => {
    const html = view([{ ...FIXTURES.proposal, verdict: { h1: "pending", h2: "pending" } }]);
    expect(html).toContain("helpers.py");
    expect(html).toContain("dl del"); expect(html).toContain("dl add");
    expect(html).toContain("Accept all"); expect(html).toContain("Reject all");
    expect(html).toContain("2 changes waiting for your review");
  });
  it("an applied card offers Undo and reports the verify verdict; new errors are listed", () => {
    const ok = view([{ ...FIXTURES.proposal, verdict: { h1: "accepted", h2: "accepted" }, applied: { checkpointId: "cp1", newErrors: [] } }]);
    expect(ok).toContain("Applied 2 of 2 changes"); expect(ok).toContain("no new errors"); expect(ok).toContain("Undo");
    const bad = view([{ ...FIXTURES.proposal, verdict: { h1: "accepted", h2: "accepted" }, applied: { checkpointId: "cp1", newErrors: ["line 4: undefined name"] } }]);
    expect(bad).toContain("New errors after this edit"); expect(bad).toContain("undefined name");
  });
  it("a dropped card says nothing was applied; an undone one says the file is back", () => {
    expect(view([{ ...FIXTURES.proposal, dropped: true }])).toContain("Not applied");
    expect(view([{ ...FIXTURES.proposal, verdict: { h1: "accepted", h2: "accepted" }, applied: { checkpointId: "c", newErrors: [], undone: true } }])).toContain("Undone");
  });
  it("Task C on screen: the failed model, the reason, and who answers next", () => {
    const html = view([FIXTURES.model]);
    expect(html).toContain("nvidia-nim/nemotron-super"); expect(html).toContain("HTTP 403: Forbidden"); expect(html).toContain("google-gemini/gemini-flash-lite");
  });
  it("…and the line that says who answered keeps its words in one block", () => {
    const html = view([{ kind: "model", note: { kind: "answered", model: "google-gemini/gemini-flash-lite", fellBack: true } }]);
    expect(html).toContain("<span>Answered by <strong>google-gemini/gemini-flash-lite</strong> (the first model failed).</span>");
  });
  it("a plan card shows the plan file, title and steps, with Accept and Reject until decided (as in Devin)", () => {
    const h = view([FIXTURES.plan]);
    expect(h).toContain("plan-t1.md"); expect(h).toContain("Doc comment for TracebackType"); expect(h).toContain("Accept"); expect(h).toContain("Reject");
    expect(view([FIXTURES.plan], true)).toContain("Waiting for the turn to finish");
    const done = view([{ ...FIXTURES.plan, state: "accepted" }]);
    expect(done).toContain("Implementing in Code mode"); expect(done).not.toContain("plan-ask");
    expect(view([FIXTURES.plan, { kind: "tool", id: "c9", threadId: "main", name: "write_plan", args: "{}", state: "ok" }])).not.toContain("tool-head");   // the card replaces the tool row
  });
  it("a command that asks shows the command with Allow and Deny", () => {
    const h = view([{ kind: "command", id: "cmd-1", command: "pytest -q", state: "asking" }]);
    expect(h).toContain("Allow"); expect(h).toContain("Deny"); expect(h).toContain("pytest -q"); expect(h).toContain(">pytest<");
  });
  it("a finished command shows its output right in the card, with how it ended (as in Devin)", () => {
    const h = view([{ kind: "command", id: "c", command: "pgrep -af extensionDevelopmentPath | head -5", state: "done", output: "173946 /home/de3p/code --ozone\n174196 /usr/share/code\n", exit: 0, seconds: 0.4 }]);
    expect(h).toContain(">pgrep<"); expect(h).toContain("pgrep -af extensionDevelopmentPath | head -5");
    expect(h).toContain("173946 /home/de3p/code --ozone"); expect(h).toContain("Exited with code 0"); expect(h).toContain("0.4 s");
    expect(h).not.toContain("Show output");                         // no toggle: the output is there
  });
  it("a failing command is marked, a long output offers the rest, a running one shows what it has so far", () => {
    expect(view([{ kind: "command", id: "c", command: "pytest", state: "done", output: "FAILED x\n", exit: 2, seconds: 3.2 }])).toContain("Exited with code 2");
    expect(view([{ kind: "command", id: "c", command: "pytest", state: "done", output: "FAILED x\n", exit: 2 }])).toContain("cmd-end bad");
    const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    expect(view([{ kind: "command", id: "c", command: "ls", state: "done", output: long, exit: 0 }])).toContain("Show all 40 lines");
    const live = view([{ kind: "command", id: "c", command: "pytest -q", state: "running", output: "..F.\n" }]);
    expect(live).toContain("..F."); expect(live).toContain("spinner"); expect(live).not.toContain("Exited");
    expect(view([{ kind: "command", id: "c", command: "pytest -q", state: "running" }])).toContain("Running…");
  });
  it("a timed-out command says so; a refusal shows its reason", () => {
    expect(view([{ kind: "command", id: "c", command: "sleep 999", state: "done", output: "", exit: null, seconds: 120, note: "timed out (wall_clock)" }])).toContain("timed out (wall_clock)");
    expect(view([{ kind: "command", id: "c", command: "sudo x", state: "denied", output: "Refused by the command policy: sudo is not allowed." }])).toContain("Refused by the command policy");
    expect(view([{ kind: "command", id: "c", command: "rm x", state: "denied" }])).toContain("you denied it");
  });
  it("the card's title is the program, not the whole line", async () => {
    const { commandName } = await import("../src/components/rows.js");
    expect([commandName("pytest -q"), commandName("cd x && ls"), commandName("FOO=1 python -m pytest"), commandName("/usr/bin/env node x"), commandName("")]).toEqual(["pytest", "cd", "python", "env", "shell"]);
  });
  it("the run status follows the status event", () => {
    expect(view([{ kind: "status", state: "running" }])).toContain("Working");
    expect(view([{ kind: "status", state: "paused" }])).toContain("Waiting for your review");
    expect(view([{ kind: "status", state: "error", message: "boom" }])).toContain("boom");
    expect(view([{ kind: "status", state: "cancelled", message: "client-cancelled" }])).toContain("Stopped");
  });
  it("model text is data: HTML in it is shown as text", () => {
    const html = view([{ kind: "text", id: "x", threadId: "main", text: "<img src=x onerror=alert(1)> and <script>alert(1)</script>", reasoning: "" }]);
    expect(html).not.toContain("<img"); expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img");
  });
  it("links: only http(s) become anchors; javascript: stays text", () => {
    const html = renderToString(<div>{md("[ok](https://example.com) [bad](javascript:alert(1))")}</div>);
    expect(html).toContain('href="https://example.com"'); expect(html).not.toContain("javascript:alert(1)\"");
  });
  it("a file written in code becomes a button only when the host can open it", () => {
    expect(renderToString(<div>{md("see `src/a.py:3`", { onFile: () => undefined })}</div>)).toContain("md-file");
    expect(renderToString(<div>{md("see `src/a.py:3`")}</div>)).not.toContain("md-file");
  });
});

describe("the rest of the chat renders", () => {
  const rows: ModelRow[] = [
    { name: "nvidia-nim/nemotron-super", provider: "nvidia-nim", short: "nemotron-super", p50Ms: 740, ok: 4, failed: 0, benchedMin: null, contextLength: 131072, recent: true },
    { name: "google-gemini/gemini-flash-lite", provider: "google-gemini", short: "gemini-flash-lite", p50Ms: null, ok: 0, failed: 1, benchedMin: 5, contextLength: 1048576, recent: false },
  ];
  const chrome = { ...emptyChrome(), model: "nvidia-nim/nemotron-super", mode: "bypass" as const, folder: "flask", trueforge: "connected" as const, attached: { path: "src/a.py", start: 3, end: 9 } };
  const items: CompletionItem[] = [
    { kind: "file", label: "app.py", detail: "src/flask", insert: "src/flask/app.py", group: "Open files" },
    { kind: "folder", label: "flask/", detail: "src", insert: "src/flask/", group: "Files & folders" },
    { kind: "symbol", label: "Flask", detail: "src/flask/app.py:109", insert: "symbol:Flask", group: "Symbols" },
    { kind: "rule", label: "style", detail: "rule · how we write Python", insert: "rule:style", group: "Rules & skills" },
  ];
  const props = { chrome, models: { rows, auto: true }, draft: "look at @app", setDraft: () => undefined, completions: { kind: "@" as const, prefix: "app", items }, clearCompletions: () => undefined, onSend: () => undefined, onStop: () => undefined, onFocus: () => undefined, onComplete: () => undefined, onMode: () => undefined, onModel: () => undefined, onModelsOpen: () => undefined, onDetach: () => undefined, focusTick: 0 };
  it("the composer: the selection chip, the mode, the model, completions", () => {
    const html = renderToString(<Composer {...props} />);
    expect(html).toContain("a.py#L3-9"); expect(html).toContain("Bypass Permissions"); expect(html).toContain("nemotron-super");
    for (const g of ["Open files", "Files &amp; folders", "Symbols", "Rules &amp; skills"]) expect(html).toContain(g);
    expect(html).toContain("app.py"); expect(html).toContain("flask/"); expect(html).toContain("how we write Python");
    expect(renderToString(<Composer {...props} completions={{ ...props.completions, prefix: "ap" }} />)).not.toContain("Open files");   // a reply for an older token is not shown
  });
  it("selecting text alone never puts a chip in the prompt box; only an attached selection does", () => {
    const none = renderToString(<Composer {...props} chrome={{ ...chrome, attached: null }} />);
    expect(none).not.toContain("a.py#L3-9"); expect(none).not.toContain("attach-chip");
    const some = renderToString(<Composer {...props} />);
    expect(some).toContain("a.py#L3-9"); expect(some).toContain("Remove the attached selection");
  });
  it("the composer while busy offers Stop", () => { expect(renderToString(<Composer {...props} chrome={{ ...chrome, busy: true }} />)).toContain('aria-label="Stop"'); });
  it("the sidebar lists sessions with their age", () => {
    const none = (): void => undefined;
    const row = { id: "s1", title: "Fix the redirect", updatedAt: 0, running: false, createdAt: 0, pinned: false, archived: false, renamed: false, model: "", turns: 1, edits: 0, preview: "" };
    const html = renderToString(<Sidebar sessions={[row]} activeId="s1" chrome={chrome} now={51 * 60_000} onNew={none} onSwitch={none} onDelete={none} onRename={none} onPin={none} onArchive={none} onPrefs={none} onLayout={none} />);
    expect(html).toContain("Fix the redirect"); expect(html).toContain("51 minutes ago"); expect(html).toContain("New session");
  });
  it("the empty state, in both shapes", () => {
    expect(renderToString(<Empty surface="agent" folder="flask" onPick={() => undefined} />)).toContain("What should we work on?");
    expect(renderToString(<Empty surface="dock" folder="" onPick={() => undefined} />)).toContain("Ask co4fe3");
  });
  it("the menus render closed (their open state needs a browser)", () => {
    expect(renderToString(<ModeMenu mode="plan" onMode={() => undefined} />)).toContain("Plan");
    expect(renderToString(<ModelMenu current="" rows={[]} auto onPick={() => undefined} onOpen={() => undefined} />)).toContain("No model");
  });
});

describe("the context meter (Devin's ring)", () => {
  it("is hidden until TrueForge reported usage; then the ring says how full the window is", async () => {
    const { ContextMeter, kTokens } = await import("../src/components/ContextMeter.js");
    expect(renderToString(<ContextMeter usage={null} pack={null} />)).toBe("");
    const h = renderToString(<ContextMeter usage={FIXTURES.usage} pack={null} />);
    expect(h).toContain('aria-label="18% (46K / 262K) context used"');
    expect([kTokens(812), kTokens(2863), kTokens(46_400), kTokens(262_144)]).toEqual(["812", "2.9K", "46K", "262K"]);
    expect(renderToString(<ContextMeter usage={{ ...FIXTURES.usage, inputTokens: 230_000 }} pack={null} />)).toContain("ctx-meter bad");
    expect(renderToString(<ContextMeter usage={{ ...FIXTURES.usage, window: null }} pack={null} />)).toContain("46K tokens in context");
  });
  it("the reducer keeps only the latest usage, outside the transcript rows", () => {
    const st = applyPanelBatch(emptyPanel(), [FIXTURES.usage, { ...FIXTURES.usage, inputTokens: 50_000 }]);
    expect(st.usage?.inputTokens).toBe(50_000); expect(st.order).toHaveLength(0);
  });
});

describe("the review bar", () => {
  it("shows the files, the totals, and Accept all / Reject all; nothing when nothing waits", () => {
    const h = renderToString(<Wrap><ReviewBar keys={["k1", "k2"]} files={2} adds={14} removes={3} /></Wrap>);
    expect(h).toContain("2 files"); expect(h).toContain("+14"); expect(h).toContain("−3"); expect(h).toContain("Accept all"); expect(h).toContain("Reject all"); expect(h).toContain("Quick review");
    expect(renderToString(<Wrap><ReviewBar keys={[]} files={0} adds={0} removes={0} /></Wrap>)).toBe("");
  });
});

describe("ErrorBoundary", () => {
  it("shows a small notice for one failed row and a reload button for the whole view", () => {
    const row = new ErrorBoundary({ scope: "row", label: "pack", children: null });
    row.state = ErrorBoundary.getDerivedStateFromError(new Error("React error #62"));
    expect(renderToString(<>{row.render()}</>)).toContain("Could not show this item (pack)");
    const app = new ErrorBoundary({ scope: "app", children: null });
    app.state = ErrorBoundary.getDerivedStateFromError(new Error("x"));
    expect(renderToString(<>{app.render()}</>)).toContain("Reload the view");
  });
  it("renders its children when nothing failed", () => {
    expect(renderToString(<ErrorBoundary scope="row"><b>fine</b></ErrorBoundary>)).toContain("fine");
  });
});
