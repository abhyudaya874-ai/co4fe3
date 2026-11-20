import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { toolsForMode, APPROVAL, type Mode } from "../runtime/modes.js";

export type AgentSpec = TrueForgeApi.AgentSpec;

// A spec update keeps the session's history (SessionPool.chat), so earlier Code-mode turns show propose_edit calls.
// Weak models then call it anyway and loop on "not found in tool mapping": say plainly that it is gone.
const NO_EDIT_TOOLS = "propose_edit and run_command do not exist in this mode, even if earlier turns used them: never call them.";

export const MODE_TAIL: Record<Mode, string> = {
  agent: "",
  ask: `\nMODE: ask. Answer the question with file:line references. ${NO_EDIT_TOOLS} If the user asks for a change, describe it and tell them to switch to Code or Plan mode.`,
  plan: `\nMODE: plan. Investigate with the read-only tools, then call write_plan once: a short title, a one-line summary, and a markdown body of numbered steps, each naming the file, the exact change and how to verify it. Then stop with one short sentence. ${NO_EDIT_TOOLS} Even a one-line change gets a plan: the user clicks Accept and Code mode implements it.`,
};

const RULES_FIRST = "Read this section first, before any tool call or reply, and follow it throughout. It comes from the repository owner: AGENTS.md, rules and skills. If an entry under \"Available on demand\" or <skills_index> matches the task, call load_instructions for it before your other tools. These rules never remove the user's review of edits or commands.";

/** The agent's instructions with the project's rules FIRST and the lead's own protocol behind them, so a model reads the rules before anything else.
 *  `project` is `renderInstructions` output (AGENTS.md, always-on rules, the skills index, the on-demand list); empty means no rules, and `base` is returned unchanged. */
export function withProjectRules(base: string, project: string | undefined): string {
  const p = project?.trim();
  return p ? `<project_rules>\n${RULES_FIRST}\n\n${p}\n</project_rules>\n\n${base}` : base;
}

/** Builds the inline-spec AgentSpec for one session: mode tools, approval gates, the model, optional crew config.
 *  `editorServer: ""` (or unset) means no tools at all — the inline agent is one model call (rule 60 lever 1). */
export function buildSpec(file: AgentSpec, o: { model: string; editorServer?: string; mode?: Mode; instructions?: string; contextLength?: number; crew?: boolean }): AgentSpec {
  const mode = o.mode ?? "agent";
  const spec = structuredClone(file) as AgentSpec;
  spec.model = { ...(spec.model as AgentSpec["model"]), name: o.model };
  spec.instructions = `${o.instructions ?? String(spec.instructions ?? "")}${MODE_TAIL[mode]}`;
  const tools = toolsForMode(mode);                                       // one map decides (rule 50 §1, V3Code availableTools)
  const gated = Object.keys(APPROVAL).filter((t) => (tools as readonly string[]).includes(t));
  const editor = o.editorServer;
  spec.mcpServers = !editor ? [] : (spec.mcpServers?.map((m) => (m.name === "$EDITOR" ? {
    ...m, name: editor,
    enableTools: mode === "agent" ? ["@all"] : [...tools],
    // The file's own gated list must not leak into ask/plan: gated is [] there. (If TrueForge ever rejects an
    // empty list, omit it — workflow 07 §1 — and note it in docs/progress/07-crew.md.)
    requireApprovalForTools: gated,
  } : m)) ?? []);
  if (spec.config?.dynamicSubAgents && o.crew === false) spec.config.dynamicSubAgents = { enabled: false };
  const c = spec.config?.contextManagement?.compaction;
  if (c?.enabled && o.contextLength) c.trigger = { type: "input_tokens", value: Math.floor(o.contextLength * 0.6) };
  return spec;
}
