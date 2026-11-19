import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { toolsForMode, APPROVAL, type Mode } from "../runtime/modes.js";

export type AgentSpec = TrueForgeApi.AgentSpec;

export const MODE_TAIL: Record<Mode, string> = {
  agent: "",
  ask: "\nAnswer the question with file:line references. You cannot change files.",
  plan: "\nEnd with a numbered plan: each step names the file, the change and how to verify it. You cannot change files.",
};

/** Builds the inline-spec AgentSpec for one session: mode tools, approval gates, the model, optional crew config.
 *  `editorServer: ""` means no tools at all (the inline agent is one model call, rule 60 lever 1). */
export function buildSpec(file: AgentSpec, o: { model: string; editorServer?: string; mode?: Mode; instructions?: string; contextLength?: number; crew?: boolean }): AgentSpec {
  const mode = o.mode ?? "agent";
  const enabled = toolsForMode(mode);
  const gated = Object.keys(APPROVAL).filter((t) => (enabled as readonly string[]).includes(t));
  const base = file as unknown as Record<string, unknown>;
  const instructions = `${o.instructions ?? String(base.instructions ?? "")}${MODE_TAIL[mode]}`;
  return {
    ...file,
    model: { ...(file.model as AgentSpec["model"]), name: o.model },
    instructions,
    mcpServers: o.editorServer ? [{ name: o.editorServer, preload: true, enableTools: [...enabled], requireApprovalForTools: gated }] : [],
    config: {
      ...(file.config as AgentSpec["config"]),
      contextManagement: { compaction: { enabled: true, ...(o.contextLength ? { trigger: { type: "input_tokens", value: Math.round(o.contextLength * 0.6) } } : {}) }, largeToolResponse: { enabled: false } },
      dynamicSubAgents: { enabled: o.crew ?? false },
    },
  } as AgentSpec;
}
