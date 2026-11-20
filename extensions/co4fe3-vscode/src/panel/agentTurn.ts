import * as vscode from "vscode";
import type { PendingCall, TrueForgeApi, ContextPack, InstructionSet } from "@co4fe3/agent-core";
import type { PanelEvent, UiCommand } from "@co4fe3/agent-core/panel";
import { sessionUrl, renderPack, renderInstructions, renderActiveSkills, selectInline, activeSkills, expandWorkflow, fromForge, TurnPolicy, toolNameOf, Marks, type TurnOutcome } from "@co4fe3/agent-core";
import type { Bridge } from "./bridge.js";
import type { Board } from "@co4fe3/agent-core";
import type { Crew } from "./crew.js";
import type { PauseDeps, PauseMaker } from "./pause.js";
import type { Router } from "../forge/router.js";
import type { SessionPool } from "../forge/sessions.js";
import type { ReviewController } from "../review/controller.js";
import type { EditorHost } from "@co4fe3/agent-core";
import type { Config } from "../config.js";

export interface AgentTurnDeps {
  host: EditorHost;
  review: ReviewController;
  crew: Crew;
  board: Board;
  sessions: SessionPool;
  router: Router;
  bridge: Bridge;
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
}

const LEAD = "";

/** One agent turn: pack → instructions → session → stream → pauses → done. Send is Stop while running. */
export class AgentTurns {
  private running: AbortController | null = null;

  constructor(private d: AgentTurnDeps, private pauseMaker: PauseMaker) {}

  get busy(): boolean { return this.running !== null; }

  async send(text: string): Promise<void> {
    if (this.running) return;                                     // Send is Stop while running (rule 20, trap 3)
    const ac = new AbortController(); this.running = ac;
    const turnKey = `t${Date.now().toString(36)}`;
    this.d.turn.current = { id: turnKey, signal: ac.signal, policy: new TurnPolicy(turnKey) };
    const bridge = this.d.bridge;
    const marks = new Marks(); marks.mark("enter");
    bridge.push({ kind: "user", turnId: turnKey, text });
    try {
      const mode = this.d.cfg().mode;                                   // agent | ask | plan, from the header chip (rule 50 §1)
      this.d.crew.reset(mode);                                          // members and the watchdog belong to one request
      const toolNames = new Map<string, string>();                      // toolCallId → bare name, for board_write pushes
      const pack = await this.d.packFor(text, this.activePath(), this.recentPaths());   // rule 40: ≤ 800 ms full, else quick, else none
      bridge.push({ kind: "pack", pack });
      const set = await this.d.instructions();
      const files = pack.items.map((i) => i.path);
      const sel = selectInline(set, files);
      const skills = set.items.filter((i) => i.kind === "skill");
      const active = activeSkills(set, text, files);
      bridge.push({ kind: "instructions", inline: sel.inline.map((i) => i.name), onDemand: sel.onDemand.length, activeSkills: active.map((s) => s.name) });
      const session = await this.d.sessions.agent(renderInstructions(LEAD, sel, skills), mode, this.d.router.order("agent")[0] ?? "");   // inline-spec session; buildSpec sets enableTools for the mode
      marks.mark("session");
      bridge.push({ kind: "status", state: "running", sessionUrl: sessionUrl(this.d.cfg().trueforge.url, session.id) });
      const message = `${renderActiveSkills(active)}${renderPack(pack)}\n\n${expandWorkflow(set, text).text}`;   // volatile parts after the stable prefix
      const out: TurnOutcome = await this.d.router.agent(session, message, {
        onEvent: (e, index) => {
          if (e.type === "turn.created") marks.mark("created");
          if (e.type === "model.message" || e.type === "model.message.delta") marks.mark("firstDelta");
          for (const pe of fromForge(e, index, { mode, serverName: this.d.serverName })) {
            if (pe.kind === "tool") marks.mark("firstTool");
            bridge.push(pe);
          }
          const stop = this.d.crew.onEvent(e);
          if (e.type === "model.message") for (const c of e.toolCalls ?? []) { const n = toolNameOf(c, this.d.serverName); if (n) toolNames.set(c.id, n); }
          if (e.type === "tool.response" && toolNames.get(e.toolCallId) === "board_write")
            bridge.push({ kind: "board", entries: this.d.board.read() });   // the board card updates live (rule 50 §5)
          if (stop) { bridge.push({ kind: "marker", id: `watch-${e.id}`, text: `Stopped: ${stop}` }); ac.abort(); }   // the crew watchdog (rule 50 §6)
        },
        onPause: async (pending, index, sig) => { marks.mark("review"); return await this.pauseMaker({ host: this.d.host, review: this.d.review, crew: this.d.crew, serverName: this.d.serverName, mode, turnKey, sideEffect: () => undefined, autoApproveTerminal: this.d.cfg().autoApprove.terminal, approveCommand: this.d.approveCommand })(pending, index, sig); },
        onNote: (n) => bridge.push({ kind: "model", note: n }),            // attempt/failed/answered rows (rule 70)
      }, ac.signal);
      this.d.review.closeTurn(turnKey);                               // drops undecided proposals (rule 30)
      marks.mark("done");
      const line = marks.line(this.d.router.lastModel());
      this.d.out.info(line);
      this.d.status.setTtft(marks.span("enter", "firstDelta") ?? 0, this.d.router.lastModel());
      bridge.push({ kind: "latency", line });
      bridge.push({ kind: "status", state: out.status === "done" ? "done" : out.status, message: out.status === "error" ? out.message : undefined });
      bridge.flush();
    } catch (e) {
      bridge.push({ kind: "status", state: "error", message: e instanceof Error ? e.message : String(e) });
      bridge.flush();
    } finally {
      this.d.turn.current = this.d.turn.idle;
      this.running = null;
    }
  }

  /** V3Code's abortRunning order (rule 30): UI first, then members cancelled, then the network. */
  stop(): void {
    this.d.bridge.push({ kind: "status", state: "stopping" }); this.d.bridge.flush();
    for (const pe of this.d.crew.cancelAll()) this.d.bridge.push(pe);   // every non-terminal member → "cancelled", before anything else
    this.running?.abort();                                           // rejects pending reviews; runTurn calls sessions.cancel
    this.running = null;
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

