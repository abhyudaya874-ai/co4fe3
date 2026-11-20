import * as vscode from "vscode";
import type { PendingCall, TrueForgeApi, ContextPack, InstructionSet, EditorHost, Board } from "@co4fe3/agent-core";
import type { Hub, UiMode } from "@co4fe3/agent-core/panel";
import { runtimeOf } from "@co4fe3/agent-core/panel";
import { sessionUrl, renderPack, renderInstructions, renderActiveSkills, selectInline, activeSkills, expandWorkflow, fromForge, findToolCall, parseCommandResult, safeJson, sha256Hex, jail, TurnPolicy, toolNameOf, Marks, type TurnOutcome } from "@co4fe3/agent-core";
import type { Crew } from "./crew.js";
import type { PauseMaker } from "./pause.js";
import type { Router } from "../forge/router.js";
import type { SessionPool, SpecFor } from "../forge/sessions.js";
import type { ReviewController } from "../review/controller.js";
import type { Config } from "../config.js";

export interface AgentTurnDeps {
  host: EditorHost;
  review: ReviewController;
  crew: Crew;
  board: Board;
  sessions: SessionPool;
  router: Router;
  hub: Hub;
  specFor: SpecFor;
  /** The composer's mode now (Code / Ask / Plan / Bypass). */
  uiMode(): UiMode;
  cfg(): Config;
  serverName: string;
  instructions(): Promise<InstructionSet>;
  packFor(text: string, active?: string, recent?: string[]): Promise<ContextPack>;
  approveCommand(p: PendingCall, signal: AbortSignal): Promise<TrueForgeApi.TurnUserEventMessage>;
  /** The live turn the MCP tools see (turn id for list_changes, signal so Stop kills run_command/search, per-turn policy). */
  turn: { idle: { id: string; signal: AbortSignal; policy: TurnPolicy }; current: { id: string; signal: AbortSignal; policy: TurnPolicy } };
  recent(): string[];
  out: vscode.LogOutputChannel;
  status: { setTtft(ms: number, model: string): void };
  /** A model answered: the menu's "Recently used". */
  answered(model: string): void;
}

const MAX_ATTACH_LINES = 200;
const STOP_GRACE_MS = 8000;                                           // how long Stop waits for the turn to unwind before it frees the UI

/** One agent turn: pack → instructions → session → stream → pauses → done. Send is Stop while running. */
export class AgentTurns {
  private running: AbortController | null = null;

  constructor(private d: AgentTurnDeps, private pauseMaker: PauseMaker) {}

  get busy(): boolean { return this.running !== null; }

  async send(text: string, attach?: { path: string; start: number; end: number }): Promise<void> {
    if (this.running) return;                                     // Send is Stop while running (rule 20, trap 3)
    const ac = new AbortController(); this.running = ac;
    const turnKey = `t${Date.now().toString(36)}`;
    this.d.turn.current = { id: turnKey, signal: ac.signal, policy: new TurnPolicy(turnKey) };
    const hub = this.d.hub;
    const marks = new Marks(); marks.mark("enter");
    hub.push({ kind: "user", turnId: turnKey, text, ...(attach ? { attach } : {}) });
    hub.push({ kind: "status", state: "running" });               // the UI answers at once; the session and the pack take a moment
    try {
      const { mode, autoApproveCommands } = runtimeOf(this.d.uiMode());   // Code | Ask | Plan | Bypass (rule 50 §1)
      this.d.crew.reset(mode);                                          // members and the watchdog belong to one request
      const active = attach?.path ?? this.activePath();
      const pack = await this.d.packFor(text, active, this.recentPaths());   // rule 40: ≤ 800 ms full, else quick, else none
      hub.push({ kind: "pack", pack, turnId: turnKey });
      const set = await this.d.instructions();
      const files = pack.items.map((i) => i.path);
      const sel = selectInline(set, files);
      const skills = set.items.filter((i) => i.kind === "skill");
      const activeSk = activeSkills(set, text, files);
      hub.push({ kind: "instructions", inline: sel.inline.map((i) => i.name), onDemand: sel.onDemand.length, activeSkills: activeSk.map((s) => s.name), turnId: turnKey });
      // The lead's own instructions (the crew protocol, tool use) stay; the project's rules are appended behind them.
      const project = renderInstructions("", sel, skills).trim();
      const model = this.d.router.order("agent")[0] ?? "";
      const forge = await this.d.sessions.chat(hub.forge, { project, instr: sha256Hex(project).slice(0, 12), mode, model });
      hub.forge = forge;                                                // the next message continues this TrueForge session
      const url = sessionUrl(this.d.cfg().trueforge.url, forge.sessionId);
      hub.setChrome({ sessionUrl: url });
      marks.mark("session");
      const chat = { id: forge.sessionId, model: forge.model };
      const selection = attach ? await this.selectionBlock(attach) : "";
      const message = `${renderActiveSkills(activeSk)}${renderPack(pack)}\n\n${selection}${expandWorkflow(set, text).text}`;   // volatile parts after the stable prefix
      const out: TurnOutcome = await this.d.router.agent(chat, message, {
        specFor: (m) => this.d.specFor(mode, m, project),               // a fallback switches the model only: same mode, same project rules
        onEvent: (e, index) => {
          if (e.type === "turn.created") marks.mark("created");
          if (e.type === "model.message" || e.type === "model.message.delta") marks.mark("firstDelta");
          for (const pe of fromForge(e, index, { mode, serverName: this.d.serverName })) {
            if (pe.kind === "tool") marks.mark("firstTool");
            hub.push(pe);
          }
          const stop = this.d.crew.onEvent(e);
          if (e.type === "tool.response") {                                 // the call lives in the merged index (streamed calls arrive as deltas)
            const call = findToolCall(index, e.toolCallId);
            const tool = toolNameOf(call, this.d.serverName);
            if (tool === "board_write") hub.push({ kind: "board", entries: this.d.board.read() });   // the board card updates live (rule 50 §5)
            if (tool === "run_command") {                                   // the command card ends with its output, exit code and duration
              const args = safeJson(call?.function?.arguments) as { command?: string } | undefined;
              const r = parseCommandResult(e.content);
              const note = r.timedOut ? `timed out (${r.timedOut})` : r.killed ? "killed" : undefined;
              hub.push({ kind: "command", id: `cmd-${e.toolCallId}`, command: args?.command ?? "", state: "done", output: r.output, exit: r.exit, seconds: r.seconds, ...(note ? { note } : {}) });
            }
          }
          if (stop) { hub.push({ kind: "marker", id: `watch-${e.id}`, text: `Stopped: ${stop}` }); ac.abort(); }   // the crew watchdog (rule 50 §6)
        },
        onPause: async (pending, index, sig) => { marks.mark("review"); return await this.pauseMaker({ host: this.d.host, review: this.d.review, crew: this.d.crew, serverName: this.d.serverName, mode, turnKey, sideEffect: () => undefined, autoApproveTerminal: autoApproveCommands || this.d.cfg().autoApprove.terminal, approveCommand: this.d.approveCommand })(pending, index, sig); },
        onNote: (n) => hub.push({ kind: "model", note: n, turnId: turnKey }),            // attempt/failed/answered rows (rule 70)
      }, ac.signal);
      hub.forge = { ...forge, model: chat.model };                      // a fallback may have changed the session's model
      if (out.status === "done") this.d.answered(this.d.router.lastModel());
      this.d.review.closeTurn(turnKey);                               // drops undecided proposals (rule 30)
      marks.mark("done");
      const line = marks.line(this.d.router.lastModel());
      this.d.out.info(line);
      this.d.status.setTtft(marks.span("enter", "firstDelta") ?? 0, this.d.router.lastModel());
      if (this.running !== ac) return;                                // released by Stop's watchdog: a newer turn owns the status now
      hub.push({ kind: "latency", line });
      hub.push({ kind: "status", state: out.status === "done" ? "done" : out.status, message: out.status === "error" ? out.message : undefined });
      hub.flush();
    } catch (e) {
      this.d.review.closeTurn(turnKey);
      if (this.running !== ac) return;
      hub.push({ kind: "status", state: "error", message: e instanceof Error ? e.message : String(e) });
      hub.flush();
    } finally {
      if (this.running === ac) {                                     // a turn that Stop already released must not clear the next one's state
        this.d.turn.current = this.d.turn.idle;
        this.running = null;
      }
    }
  }

  /**
   * V3Code's abortRunning order (rule 30): UI first, then members cancelled, then the network.
   * The turn stays "running" until it has unwound, so a message sent right after Stop waits for it instead of racing it.
   * If it does not unwind in time (a hung request), the UI is released anyway.
   */
  stop(): void {
    const ac = this.running;
    if (!ac || ac.signal.aborted) return;
    this.d.hub.push({ kind: "status", state: "stopping" }); this.d.hub.flush();
    for (const pe of this.d.crew.cancelAll()) this.d.hub.push(pe);   // every non-terminal member → "cancelled", before anything else
    ac.abort();                                                      // rejects pending reviews; runTurn calls sessions.cancel
    const t = setTimeout(() => {
      if (this.running !== ac) return;
      this.running = null;
      this.d.hub.push({ kind: "status", state: "cancelled", message: "stopped" });
      this.d.hub.flush();
    }, STOP_GRACE_MS);
    t.unref?.();
  }

  /** The selected lines, as the model sees them. Read through the host, so an open unsaved buffer counts. */
  private async selectionBlock(a: { path: string; start: number; end: number }): Promise<string> {
    let rel: string;
    try { rel = jail(this.d.host.root, a.path); } catch { return ""; }   // a path from the webview is jailed like any other
    const text = await this.d.host.readText(rel);
    if (text === null) return "";
    const lines = text.split("\n").slice(Math.max(0, a.start - 1), a.end).slice(0, MAX_ATTACH_LINES);
    return `The user selected lines ${a.start}-${a.end} of ${rel}:\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n\n`;
  }

  private activePath(): string | undefined {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return undefined;
    const f = vscode.workspace.workspaceFolders?.[0];
    if (!f) return undefined;
    const rel = vscode.workspace.asRelativePath(ed.document.uri, false);
    return rel;
  }
  private recentPaths(): string[] {
    return [...vscode.window.visibleTextEditors.map((e) => vscode.workspace.asRelativePath(e.document.uri, false)), ...this.d.recent()];
  }
}
