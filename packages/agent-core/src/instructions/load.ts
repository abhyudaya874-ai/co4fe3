export type Trigger = "always_on" | "glob" | "model_decision" | "manual";
export interface Instruction {
  kind: "file" | "rule" | "skill" | "workflow"; name: string; path: string; trigger: Trigger; description: string;
  globs: string[]; keywords: string[]; alwaysApply: boolean; loadOnDemand: boolean; body: string; tokens: number;
}
export interface InstructionSet { items: Instruction[]; sources: string[] }    // e.g. ["AGENTS.md", ".devin", ".v3code/skills"]

export const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md", ".github/AGENTS.md", ".cursorrules", ".v3coderules", ".voidrules"] as const;
export const FILE_CAP = (path: string): number => (path === "AGENTS.md" ? 8000 : 4000);   // chars
