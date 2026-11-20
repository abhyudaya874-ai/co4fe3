import type { Profile } from "../runtime/modes.js";
import type { MemberStatus } from "../crew/evidence.js";
import type { ContextPack } from "../context/pack.js";
import type { BoardEntry } from "../crew/board.js";
import type { Mode } from "../runtime/modes.js";
import type { Note } from "../forge/fallback.js";

export type { Mode };

export type HunkView = { id: string; oldStart: number; oldLines: string[]; newLines: string[] };

export type PanelEvent =
  | { kind: "user"; turnId: string; text: string }
  | { kind: "text"; id: string; threadId: string; text: string; reasoning: string }            // snapshot of one model.message (same id replaces)
  | { kind: "tool"; id: string; threadId: string; name: string; args: string; state: "running" | "ok" | "error"; result?: string; ms?: number }
  | { kind: "member"; threadId: string; title: string; profile?: Profile; status: MemberStatus; reason?: string }   // reducer MERGES member rows (rule 50 §4)
  | { kind: "message"; id: string; from: string; to: string; text: string }                     // brief (to-<thread>) / report (from-<thread>)
  | { kind: "pack"; pack: ContextPack }
  | { kind: "instructions"; inline: string[]; onDemand: number; activeSkills: string[] }
  | { kind: "proposal"; key: string; path: string; why: string; by: string; adds: number; removes: number; hunks: HunkView[]; verdict: Record<string, "pending" | "accepted" | "rejected">; applied?: { checkpointId: string; newErrors: string[] } }
  | { kind: "command"; id: string; command: string; state: "asking" | "running" | "done" | "denied"; output?: string; exit?: number | null }
  | { kind: "board"; entries: BoardEntry[] }
  | { kind: "marker"; id: string; text: string }                                                // "context compacted", "switched to …"
  | { kind: "model"; note: Note }                                                               // from runWithFallback (rule 70)
  | { kind: "latency"; line: string }
  | { kind: "status"; state: "running" | "paused" | "stopping" | "done" | "cancelled" | "error"; message?: string; sessionUrl?: string };

export type UiCommand =
  | { type: "ready" } | { type: "send"; text: string } | { type: "stop" } | { type: "focus" }
  | { type: "decide"; key: string; hunkId: string; verdict: "accepted" | "rejected" } | { type: "decideAll"; key: string; verdict: "accepted" | "rejected" }
  | { type: "openDiff"; key: string } | { type: "command"; id: string; verdict: "allow" | "deny" }
  | { type: "undo"; checkpointId: string } | { type: "revertTurn"; turnId: string }
  | { type: "openSession" } | { type: "pickModel" } | { type: "setMode"; mode: Mode } | { type: "complete"; kind: "@" | "/"; prefix: string };
