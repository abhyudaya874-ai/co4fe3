import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { toolsForMode, APPROVAL, type Mode } from "../runtime/modes.js";

export type AgentSpec = TrueForgeApi.AgentSpec;

export const MODE_TAIL: Record<Mode, string> = {
  agent: "",
  ask: "\nMODE: ask. Answer the question with file:line references. You cannot change files or run commands.",
  plan: "\nMODE: plan. Investigate, then end with a numbered plan: each step names the file, the change and how to verify it. You cannot change files or run commands.",
};

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
