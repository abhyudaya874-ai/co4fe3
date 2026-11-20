import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSpec, withProjectRules, MODE_TAIL } from "../src/forge/spec.js";
import { APPROVAL, READ_ONLY } from "../src/runtime/modes.js";
import type { AgentSpec } from "../src/forge/spec.js";

const coder = JSON.parse(await readFile(join(import.meta.dirname, "../../../agents/co4fe3-coder.agent.json"), "utf8")) as AgentSpec;
const o = { model: "p/m", editorServer: "co4fe3-ws-abcd1234" };

describe("buildSpec (workflow 07)", () => {
  it("fills every placeholder and keeps gated tools for agent mode", () => {
    const s = buildSpec(coder, o);
    expect(JSON.stringify(s)).not.toContain("$");
    expect(s.model?.name).toBe("p/m");
    const m = s.mcpServers![0]!;
    expect(m.name).toBe("co4fe3-ws-abcd1234");
    expect(m.enableTools).toEqual(["@all"]);
    expect([...(m.requireApprovalForTools ?? [])].sort()).toEqual(Object.keys(APPROVAL).sort());
    expect(s.config?.dynamicSubAgents?.enabled).toBe(true);
  });

  it.each(["ask", "plan"] as const)("%s mode: read-only tools only, no gated tool, mode tail appended", (mode) => {
    const s = buildSpec(coder, { ...o, mode });
    const m = s.mcpServers![0]!;
    expect(m.enableTools).toEqual(mode === "plan" ? [...READ_ONLY, "write_plan"] : [...READ_ONLY]);   // Plan adds write_plan, the plan card
    for (const t of Object.keys(APPROVAL)) expect(m.enableTools).not.toContain(t);
    expect(s.instructions).toContain("propose_edit and run_command do not exist in this mode");      // history from Code turns must not tempt the model
    expect(m.requireApprovalForTools).toEqual([]);   // gated by nothing: the file's own list must not leak
    expect(s.instructions?.endsWith(MODE_TAIL[mode])).toBe(true);
  });

  it("withProjectRules puts the project's rules before the lead's own instructions, and changes nothing without rules", () => {
    const out = withProjectRules("LEAD PROTOCOL", "## Project instructions (AGENTS.md)\nUse pytest.");
    expect(out.startsWith("<project_rules>")).toBe(true);
    expect(out.indexOf("Use pytest.")).toBeLessThan(out.indexOf("LEAD PROTOCOL"));
    expect(out).toContain("before any tool call");
    expect(out.endsWith("LEAD PROTOCOL")).toBe(true);
    expect(withProjectRules("LEAD PROTOCOL", undefined)).toBe("LEAD PROTOCOL");
    expect(withProjectRules("LEAD PROTOCOL", "  \n")).toBe("LEAD PROTOCOL");
    const s = buildSpec(coder, { ...o, mode: "ask", instructions: withProjectRules("BASE", "RULES") });      // the mode tail still lands last
    expect(String(s.instructions)).toMatch(/^<project_rules>[\s\S]*RULES[\s\S]*<\/project_rules>\n\nBASE\nMODE: ask/);
  });

  it("crew: false disables dynamic subagents; unset keeps the file's value", () => {
    expect(buildSpec(coder, { ...o, crew: false }).config?.dynamicSubAgents?.enabled).toBe(false);
    expect(buildSpec(coder, o).config?.dynamicSubAgents?.enabled).toBe(true);
  });

  it("contextLength sets the compaction trigger at 60%", () => {
    const s = buildSpec(coder, { ...o, contextLength: 128_000 });
    expect(s.config?.contextManagement?.compaction?.trigger).toEqual({ type: "input_tokens", value: Math.floor(128_000 * 0.6) });
  });

  it("no editorServer → no tools at all (the inline shape)", () => {
    const s = buildSpec(coder, { model: "p/m" });
    expect(s.mcpServers).toEqual([]);
  });
});
