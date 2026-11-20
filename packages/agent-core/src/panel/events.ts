import type { Profile } from "../runtime/modes.js";
import type { MemberStatus } from "../crew/evidence.js";
import type { ContextPack } from "../context/pack.js";
import type { BoardEntry } from "../crew/board.js";
import type { Mode } from "../runtime/modes.js";
import type { SidebarPrefs } from "./protocol.js";
import type { Note } from "../forge/fallback.js";

export type { Mode };

/** One change block for the diff card. `before`/`after` are up to two unchanged lines either side (context); lines keep no newline. */
export type HunkView = { id: string; oldStart: number; oldLines: string[]; newLines: string[]; before?: string[]; after?: string[]; hidden?: number };   // hidden: lines left out of oldLines/newLines (very long hunks)

/** TrueForge's ModelMessageUsage.inputTokensBreakdown: where the input tokens of one model call went. */
export interface ContextBreakdown { harness: number; instructions: number; messages: number; skills: number; toolDefinitions: number }

export type PanelEvent =
  | { kind: "user"; turnId: string; text: string; attach?: { path: string; start: number; end: number } }   // attach: the editor selection sent with it (1-based lines)
  | { kind: "text"; id: string; threadId: string; text: string; reasoning: string }            // snapshot of one model.message (same id replaces)
  | { kind: "tool"; id: string; threadId: string; name: string; args: string; state: "running" | "ok" | "error"; result?: string; ms?: number }
  | { kind: "member"; threadId: string; title: string; profile?: Profile; status: MemberStatus; reason?: string }   // reducer MERGES member rows (rule 50 §4)
  | { kind: "message"; id: string; from: string; to: string; text: string }                     // brief (to-<thread>) / report (from-<thread>)
  | { kind: "pack"; pack: ContextPack; turnId?: string }                                    // turnId: one context card per request, in its place in the transcript
  | { kind: "instructions"; inline: string[]; onDemand: number; activeSkills: string[]; inlinePaths?: string[]; skillPaths?: string[]; turnId?: string }   // *Paths: workspace-relative file of each name, same order, so the row can open it
  | { kind: "proposal"; key: string; path: string; why: string; by: string; adds: number; removes: number; hunks: HunkView[]; verdict: Record<string, "pending" | "accepted" | "rejected">; applied?: { checkpointId: string; newErrors: string[]; undone?: boolean }; dropped?: boolean }   // dropped: the turn ended before every hunk was decided
  | { kind: "command"; id: string; command: string; state: "asking" | "running" | "done" | "denied"; output?: string; exit?: number | null; seconds?: number | null; note?: string }   // note: "timed out (wall_clock)", "killed", a refusal
  | { kind: "board"; entries: BoardEntry[] }
  | { kind: "plan"; id: string; turnId: string; title: string; summary: string; body: string; state: "proposed" | "accepted" | "rejected" }   // write_plan; one per turn (a second call replaces it)
  | { kind: "marker"; id: string; text: string }                                                // "context compacted", "switched to …"
  | { kind: "model"; note: Note; turnId?: string }                                              // from runWithFallback (rule 70)
  | { kind: "latency"; line: string }
  | { kind: "usage"; turnId: string; model: string; inputTokens: number; outputTokens: number; cacheReadTokens?: number; window: number | null; breakdown: ContextBreakdown }   // the lead's last model call (TrueForge usage): the composer's context meter
  | { kind: "status"; state: "running" | "paused" | "stopping" | "done" | "cancelled" | "error"; message?: string; sessionUrl?: string };

/** Webview → host. `mode` is a UiMode ("code" | "ask" | "plan" | "bypass", protocol.ts). */
export type UiCommand =
  | { type: "ready" } | { type: "detach" } | { type: "send"; text: string; attach?: { path: string; start: number; end: number } } | { type: "stop" } | { type: "focus" }
  | { type: "decide"; key: string; hunkId: string; verdict: "accepted" | "rejected" } | { type: "decideAll"; key: string; verdict: "accepted" | "rejected" }
  | { type: "openDiff"; key: string } | { type: "openFile"; path: string; line?: number } | { type: "command"; id: string; verdict: "allow" | "deny" }
  | { type: "undo"; checkpointId: string } | { type: "revertTurn"; turnId: string }
  | { type: "plan"; id: string; verdict: "accept" | "reject" } | { type: "openPlan"; id: string }
  | { type: "openSession" } | { type: "pickModel" } | { type: "setMode"; mode: "code" | "ask" | "plan" | "bypass" } | { type: "complete"; kind: "@" | "/"; prefix: string }
  | { type: "setModel"; name: string | null } | { type: "models" }                                   // null = automatic (the configured or discovered order)
  | { type: "newSession" } | { type: "switchSession"; id: string } | { type: "deleteSession"; id: string }
  | { type: "renameSession"; id: string; title: string } | { type: "pinSession"; id: string; pinned: boolean } | { type: "archiveSession"; id: string; archived: boolean }
  | { type: "setSidebar"; prefs: Partial<SidebarPrefs> }
  | { type: "setLayout"; layout: "agent" | "editor" };
