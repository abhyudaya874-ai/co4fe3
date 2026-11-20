import type { EditorHost } from "../host.js";
import { estimateTokens } from "../context/tokens.js";
import { truncateWithHint } from "../util/truncate.js";
import { parseFrontmatter, listAttr, boolAttr } from "./frontmatter.js";

export type Trigger = "always_on" | "glob" | "model_decision" | "manual";
export interface Instruction {
  kind: "file" | "rule" | "skill" | "workflow"; name: string; path: string; trigger: Trigger; description: string;
  globs: string[]; keywords: string[]; alwaysApply: boolean; loadOnDemand: boolean; body: string; tokens: number;
}
export interface InstructionSet { items: Instruction[]; sources: string[] }    // e.g. ["AGENTS.md", ".devin", ".v3code/skills"]

export const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md", ".github/AGENTS.md", ".cursorrules", ".v3coderules", ".voidrules"] as const;
export const FILE_CAP = (path: string): number => (path === "AGENTS.md" ? 8000 : 4000);   // chars

const RULE_DIRS = [".co4fe3/rules", ".devin/rules"];
const SKILL_DIRS = [".co4fe3/skills", ".v3code/skills", ".devin/skills"];
const WORKFLOW_DIRS = [".co4fe3/workflows", ".devin/workflows"];

/** Reads through EditorHost only. A missing file or folder is not an error. A rule without frontmatter is a manual rule. */
export async function loadInstructions(host: EditorHost): Promise<InstructionSet> {
  const items: Instruction[] = [];
  const sources: string[] = [];
  for (const f of INSTRUCTION_FILES) {
    const body = await host.readText(f);
    if (body === null) continue;
    sources.push(f);
    const cap = FILE_CAP(f);
    const cut = body.length > cap ? `${body.slice(0, cap)}\n[${f} truncated at ${cap} chars: call load_instructions with kind "file" and name "${f}" for the rest.]` : body;
    items.push({ kind: "file", name: f, path: f, trigger: "always_on", description: "", globs: [], keywords: [], alwaysApply: false, loadOnDemand: false, body: cut, tokens: estimateTokens(cut) });
  }
  const collect = async (dirs: readonly string[], kind: Instruction["kind"], parse: (path: string, body: string) => Instruction | null): Promise<void> => {
    for (const dir of dirs) {
      const files = await host.listFiles(5000);
      const inDir = files.filter((p) => p.startsWith(`${dir}/`) && p.endsWith(".md"));
      if (!inDir.length) continue;
      if (!sources.includes(dir)) sources.push(dir);
      for (const path of inDir) {
        const body = await host.readText(path);
        if (body === null) continue;
        const it = parse(path, body);
        if (it) items.push(it);
      }
    }
  };
  const fromFront = (path: string, body: string, kind: Instruction["kind"], name: string): Instruction | null => {
    const { attrs, body: text } = parseFrontmatter(body);
    const trigger = (String(attrs.trigger ?? (kind === "rule" ? "manual" : "manual")) as Trigger);
    return {
      kind, name, path, trigger: (["always_on", "glob", "model_decision", "manual"] as const).includes(trigger) ? trigger : "manual",
      description: String(attrs.description ?? ""), globs: listAttr(attrs, "globs"), keywords: listAttr(attrs, "keywords"),
      alwaysApply: boolAttr(attrs, "alwaysApply"), loadOnDemand: boolAttr(attrs, "loadOnDemand"),
      body: text, tokens: estimateTokens(text),
    };
  };
  await collect(RULE_DIRS, "rule", (path, body) => fromFront(path, body, "rule", path.split("/").at(-1)!.replace(/\.md$/, "")));
  await collect(SKILL_DIRS, "skill", (path, body) => fromFront(path, body, "skill", path.split("/").at(-2)!));
  await collect(WORKFLOW_DIRS, "workflow", (path, body) => fromFront(path, body, "workflow", path.split("/").at(-1)!.replace(/\.md$/, "")));
  return { items, sources };
}

export function selectInline(set: InstructionSet, files: readonly string[], budget = 4000): { inline: Instruction[]; onDemand: Instruction[] } {
  const order = (i: Instruction) => (i.kind === "file" ? 0 : i.kind === "rule" ? 1 : 2);
  const inline: Instruction[] = [], onDemand: Instruction[] = [];
  let used = 0;
  for (const it of [...set.items].sort((a, b) => order(a) - order(b) || a.path.localeCompare(b.path))) {
    if (it.kind === "workflow" || it.kind === "skill" || it.trigger === "manual") continue;     // skills: index + active; workflows: typed
    const wanted = it.kind === "file" || it.trigger === "always_on" || (it.trigger === "glob" && files.some((f) => globToRegExp(it.globs).some((g) => g.test(f))));
    if (wanted && used + it.tokens <= budget) { inline.push(it); used += it.tokens; } else onDemand.push(it);
  }
  return { inline, onDemand };
}

/** Skills whose triggers match this turn. Pure: `request` is the user's text, `files` the pack/mentioned/active paths. */
export function activeSkills(set: InstructionSet, request: string, files: readonly string[], budget = 1500): Instruction[] {
  const out: Instruction[] = [];
  let used = 0;
  for (const s of set.items.filter((i) => i.kind === "skill" && !i.loadOnDemand)) {
    const hit = s.alwaysApply || s.globs.some((g) => files.some((f) => globToRegExp([g]).some((r) => r.test(f)))) || s.keywords.some((k) => new RegExp(`\\b${escapeRe(k)}\\b`, "i").test(request));
    if (hit && used + s.tokens <= budget) { out.push(s); used += s.tokens; }
  }
  return out;
}

export function renderInstructions(base: string, sel: { inline: Instruction[]; onDemand: Instruction[] }, skills: readonly Instruction[]): string {
  const parts = [base];
  for (const it of sel.inline) parts.push(`\n## Project ${it.kind === "file" ? `instructions (${it.path})` : `rule: ${it.name}`}\n${it.body.trim()}`);
  if (skills.length) parts.push(`\n<skills_index>\n${skills.map((s) => `- ${s.name}: ${s.description || "(no description)"}`).join("\n")}\n</skills_index>`);
  if (sel.onDemand.length) parts.push(`\n## Available on demand (call load_instructions with kind and name)\n${sel.onDemand.map((i) => `- ${i.kind} ${i.name}: ${i.description || "(no description)"}`).join("\n")}`);
  return parts.join("\n");
}

export const renderActiveSkills = (skills: readonly Instruction[]): string =>
  skills.length ? `<active_skills>\n${skills.map((s) => `### ${s.name}\n${s.body.trim()}`).join("\n\n")}\n</active_skills>\n` : "";

/** "**" spans folders, "*" stays within one, "?" is one char. Anchored to the whole workspace-relative path. */
export function globToRegExp(globs: readonly string[]): RegExp[] {
  return globs.map((g) => {
    const s = g.replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\//g, "\u0000")                       // `**/x` → optional directory prefix
      .replace(/\*\*/g, "\u0001")                          // trailing/lone `**` → any suffix (spans dirs)
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/\u0000/g, "(?:.*/)?")
      .replace(/\u0001/g, ".*");
    return new RegExp(`^${s}$`);
  });
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "/release-check v1.2" → the workflow body with $ARGUMENTS replaced, followed by the user's text. Unknown names are left alone. */
export function expandWorkflow(set: InstructionSet, input: string): { text: string; workflow: string | null } {
  const m = /^\/([a-z0-9][\w-]*)(?:\s+([\s\S]*))?$/i.exec(input.trim());
  const wf = m && set.items.find((i) => i.kind === "workflow" && i.name === m[1]);
  if (!wf) return { text: input, workflow: null };
  const args = m![2]?.trim() ?? "";
  return { text: `Follow the project workflow "${wf.name}".\n\n${wf.body.replaceAll("$ARGUMENTS", args)}\n\nArguments: ${args || "(none)"}`, workflow: wf.name };
}

export { truncateWithHint };
