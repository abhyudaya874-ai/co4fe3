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

// Root files, always on, in this order. AGENT.md / AGENTS.local.md / .devin/global_rules.md / .windsurfrules are what Devin reads too.
export const INSTRUCTION_FILES = ["AGENTS.md", "AGENT.md", "AGENTS.local.md", "CLAUDE.md", ".devin/global_rules.md", ".github/copilot-instructions.md", ".github/AGENTS.md",
  ".cursorrules", ".windsurfrules", ".v3coderules", ".voidrules"] as const;
export const FILE_CAP = (path: string): number => (path === "AGENTS.md" ? 8000 : 4000);   // chars

// First hit wins per name (rule 85): our own folder, then Devin's, then the tools Devin imports.
const RULE_DIRS = [".co4fe3/rules", ".devin/rules", ".windsurf/rules"];
const SKILL_DIRS = [".co4fe3/skills", ".v3code/skills", ".devin/skills", ".agents/skills", ".windsurf/skills"];
const WORKFLOW_DIRS = [".co4fe3/workflows", ".devin/workflows", ".windsurf/workflows"];
const NESTED_AGENTS = /^(.+)\/AGENTS\.md$/;                         // a sub-folder's AGENTS.md applies to the files under it (Devin)
const IGNORED_DIRS = /(^|\/)(node_modules|\.git|\.venv|venv|dist|out|build|\.pytest_cache|\.tox|\.cache)\//;

const capped = (path: string, body: string): string => {
  const cap = FILE_CAP(path);
  return body.length > cap ? `${body.slice(0, cap)}\n[${path} truncated at ${cap} chars: call load_instructions with kind "file" and name "${path}" for the rest.]` : body;
};
const fileItem = (path: string, body: string, globs: string[] = []): Instruction =>
  ({ kind: "file", name: path, path, trigger: globs.length ? "glob" : "always_on", description: globs.length ? `instructions for ${globs[0]!.replace(/\/\*\*$/, "/")}` : "", globs, keywords: [], alwaysApply: false, loadOnDemand: false, body, tokens: estimateTokens(body) });

/** Reads through EditorHost only. A missing file or folder is not an error. A rule without frontmatter is a manual rule. */
export async function loadInstructions(host: EditorHost): Promise<InstructionSet> {
  const items: Instruction[] = [];
  const sources: string[] = [];
  for (const f of INSTRUCTION_FILES) {
    const body = await host.readText(f);
    if (body === null) continue;
    sources.push(f);
    items.push(fileItem(f, capped(f, body)));
  }
  const files = await host.listFiles(5000);                          // one listing for every folder below
  for (const path of files) {
    const dir = NESTED_AGENTS.exec(path)?.[1];
    if (!dir || IGNORED_DIRS.test(path) || path.startsWith(".github/")) continue;
    const body = await host.readText(path);
    if (body === null) continue;
    if (!sources.includes(path)) sources.push(path);
    items.push(fileItem(path, capped(path, body), [`${dir}/**`]));
  }
  const seen = new Set<string>();
  const collect = async (dirs: readonly string[], kind: Instruction["kind"], parse: (path: string, body: string) => Instruction | null): Promise<void> => {
    for (const dir of dirs) {
      const inDir = files.filter((p) => p.startsWith(`${dir}/`) && (kind === "skill" ? p.endsWith("/SKILL.md") : p.endsWith(".md")));
      if (!inDir.length) continue;
      if (!sources.includes(dir)) sources.push(dir);
      for (const path of inDir) {
        const body = await host.readText(path);
        if (body === null) continue;
        const it = parse(path, body);
        if (!it || seen.has(`${kind}:${it.name}`)) continue;         // an earlier folder already has this name
        seen.add(`${kind}:${it.name}`);
        items.push(it);
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
  await collect(SKILL_DIRS, "skill", (path, body) => {                // <dir>/<name>/SKILL.md; frontmatter `name` wins over the folder name
    const named = parseFrontmatter(body).attrs.name;
    return fromFront(path, body, "skill", typeof named === "string" && /^[\w-]+$/.test(named) ? named : path.split("/").at(-2)!);
  });
  await collect(WORKFLOW_DIRS, "workflow", (path, body) => fromFront(path, body, "workflow", path.split("/").at(-1)!.replace(/\.md$/, "")));
  return { items, sources };
}

export function selectInline(set: InstructionSet, files: readonly string[], budget = 4000): { inline: Instruction[]; onDemand: Instruction[] } {
  const order = (i: Instruction) => (i.kind === "file" ? 0 : i.kind === "rule" ? 1 : 2);
  const inline: Instruction[] = [], onDemand: Instruction[] = [];
  let used = 0;
  for (const it of [...set.items].sort((a, b) => order(a) - order(b) || a.path.localeCompare(b.path))) {
    if (it.kind === "workflow" || it.kind === "skill" || it.trigger === "manual") continue;     // skills: index + active; workflows: typed
    const wanted = it.trigger === "always_on" || (it.trigger === "glob" && files.some((f) => globToRegExp(it.globs).some((g) => g.test(f))));   // a sub-folder AGENTS.md is a glob item
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
  if (!m) return { text: input, workflow: null };
  const args = m[2]?.trim() ?? "";
  const wf = set.items.find((i) => i.kind === "workflow" && i.name === m[1]);
  if (wf) return { text: `Follow the project workflow "${wf.name}".\n\n${wf.body.replaceAll("$ARGUMENTS", args)}\n\nArguments: ${args || "(none)"}`, workflow: wf.name };
  const sk = set.items.find((i) => i.kind === "skill" && i.name === m[1]);   // "/skill-name" invokes a skill, as in Devin
  if (sk) return { text: `Use the project skill "${sk.name}".\n\n${sk.body.trim()}\n\nRequest: ${args || "(apply the skill to the current task)"}`, workflow: sk.name };
  return { text: input, workflow: null };
}

/** The skills that reach one turn and why: invoked with "/name", mentioned with "@skill:name", or matched by the request or files. One entry per skill. */
export function skillsUsed(set: InstructionSet, input: string, active: readonly Instruction[], mentioned: readonly Instruction[]): { name: string; result: string }[] {
  const out = new Map<string, string>();
  const note = (s: Instruction, how: string): void => { if (!out.has(s.name)) out.set(s.name, [s.description, how].filter(Boolean).join("\n")); };
  const slash = /^\/([a-z0-9][\w-]*)/i.exec(input.trim())?.[1];
  const invoked = slash && !set.items.some((i) => i.kind === "workflow" && i.name === slash) ? set.items.find((i) => i.kind === "skill" && i.name === slash) : undefined;   // a workflow of that name wins (expandWorkflow)
  if (invoked) note(invoked, `Invoked with /${invoked.name}.`);
  for (const s of mentioned) if (s.kind === "skill") note(s, `Mentioned with @skill:${s.name}.`);
  for (const s of active) note(s, "Matched this request (keyword, file or always-on) and was added to the turn.");
  return [...out].map(([name, result]) => ({ name, result }));
}

const INSTR_MENTION = /@(rule|skill|workflow):([\w-]+)/g;
/** "@rule:name", "@skill:name", "@workflow:name": that item's full text goes with this message (a manual rule's only way in, rule 85). Unknown names stay as typed. */
export function instructionMentions(set: InstructionSet, input: string): { text: string; loaded: Instruction[] } {
  const loaded: Instruction[] = [];
  for (const m of input.matchAll(INSTR_MENTION)) {
    const it = set.items.find((i) => i.kind === m[1] && i.name === m[2]);
    if (it && !loaded.includes(it)) loaded.push(it);
  }
  if (!loaded.length) return { text: input, loaded };
  return { text: `${loaded.map((i) => `<${i.kind} name="${i.name}" path="${i.path}">\n${i.body.trim()}\n</${i.kind}>`).join("\n\n")}\n\n${input}`, loaded };
}

export { truncateWithHint };
