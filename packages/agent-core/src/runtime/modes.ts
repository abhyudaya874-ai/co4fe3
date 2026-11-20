export const TOOLS = ["repo_map", "search_workspace", "find_symbol", "pack_context", "read_file", "list_changes",
  "board_read", "board_write", "load_instructions", "write_plan", "propose_edit", "run_command"] as const;   // registration order = read-first (rule 60)
export type ToolName = (typeof TOOLS)[number];
export type ApprovalKind = "edits" | "terminal";

/** The ONLY list of tools that change something outside the conversation. Everything else is read-only by definition. */
export const APPROVAL: Readonly<Partial<Record<ToolName, ApprovalKind>>> = { propose_edit: "edits", run_command: "terminal" };
/** Plan mode's output: a plan card the user accepts or rejects. It changes nothing, but only the lead in Plan mode gets it. */
export const PLAN_TOOLS: readonly ToolName[] = ["write_plan"];
export const READ_ONLY: readonly ToolName[] = TOOLS.filter((t) => !(t in APPROVAL) && !PLAN_TOOLS.includes(t));   // board_write is a note, not a code change

export type Mode = "agent" | "ask" | "plan";
/** What the lead (and therefore its members) may see in each mode. Mirrors V3Code's availableTools. */
export function toolsForMode(mode: Mode): readonly ToolName[] {
  switch (mode) {
    case "agent": return TOOLS;                                    // enableTools "@all"; write_plan refuses outside Plan mode (McpDeps.onPlan)
    case "ask": return READ_ONLY;                                  // answer questions, change nothing
    case "plan": return TOOLS.filter((t) => !(t in APPROVAL));     // investigate, then write_plan: the user accepts it and Code mode implements it
  }
}

export type Profile = "research" | "work";
/** research = read-only; work = everything the mode allows. Both still pass the human review for edits and commands. */
export function toolsForProfile(profile: Profile, mode: Mode): readonly ToolName[] {
  const inMode = toolsForMode(mode);
  return profile === "research" ? inMode.filter((t) => READ_ONLY.includes(t)) : inMode;
}
export const memberMayCall = (profile: Profile, mode: Mode, tool: string): boolean => (toolsForProfile(profile, mode) as readonly string[]).includes(tool);

const PROFILE_LINE = /^\s*(?:PROFILE|ROLE):\s*([a-z]+)/im;
const WORK_WORDS = new Set(["work", "edit", "test", "write", "fix"]);   // ROLE: synonyms, for weak models
/** The FIRST "PROFILE:" (or "ROLE:") line decides. Missing or unknown → "research": the safe default. */
export function parseProfile(brief: string, mode: Mode): Profile {
  if (mode !== "agent") return "research";                         // ask/plan force research, like V3Code's plan/debug
  const word = PROFILE_LINE.exec(brief)?.[1]?.toLowerCase();
  return word !== undefined && WORK_WORDS.has(word) ? "work" : "research";
}
