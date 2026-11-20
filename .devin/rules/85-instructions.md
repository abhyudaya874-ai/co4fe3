---
trigger: always_on
description: How the product reads the user's AGENTS.md and other instruction files, rules, skills (with V3Code-style triggers) and workflows, what goes inline versus on demand, the load_instructions tool, and slash workflows
---

# Project instructions inside co4fe3 (the product feature, not this pack)

co4fe3 reads the same files Devin and V3Code read, so a repository that already has a Devin pack, a `.v3code/`
folder or an `AGENTS.md` works unchanged. The file list, the caps and the skill triggers follow V3Code
(`docs/study/v3code.md` §8: `convertToLLMMessageService.ts`, `skillsService.ts`).

| Kind | Found at (first hit wins per name) | Frontmatter | How it reaches the agent |
|---|---|---|---|
| instruction files | `AGENTS.md`, `AGENT.md`, `AGENTS.local.md`, `CLAUDE.md`, `.devin/global_rules.md`, `.github/copilot-instructions.md`, `.github/AGENTS.md`, `.cursorrules`, `.windsurfrules`, `.v3coderules`, `.voidrules` (in this order) | none | inline in the agent instructions. AGENTS.md is cut at 8,000 chars and the others at 4,000, with a note naming how to read the rest |
| sub-folder `AGENTS.md` | `<dir>/AGENTS.md` anywhere below the root (not `node_modules`, `.venv`, …) | none | a `glob` item for `<dir>/**`: inline only when a pack, mentioned or active file is under that folder (as Devin does) |
| rules | `.co4fe3/rules/*.md`, else `.devin/rules/*.md`, else `.windsurf/rules/*.md` | `trigger`, `description`, `globs` | `always_on` → inline; `glob` → inline when a pack, mentioned or active file matches; `model_decision` → listed by description, loaded on demand; `manual` → only via `@rule:name` |
| skills | `.co4fe3/skills/<name>/SKILL.md`, `.v3code/skills/…`, `.devin/skills/…`, `.agents/skills/…`, `.windsurf/skills/…` (only `SKILL.md`; other files in the folder are supporting files) | `name`, `description`, triggers: `globs`, `keywords`, `alwaysApply`, `loadOnDemand` (top-level, or nested under `triggers:` as V3Code writes them) | all skills appear in `<skills_index>` (name, description). Matching skills go in full into `<active_skills>` in the turn message. The rest load with `load_instructions` |
| workflows | `.co4fe3/workflows/*.md`, else `.devin/workflows/*.md`, else `.windsurf/workflows/*.md` | `description`, `argument-hint` | `/name args` in the composer expands the body into the request. `/skill-name` invokes a skill the same way |

In the composer, `@` lists open files, files and folders, symbols, and rules, skills and workflows (`@rule:name`,
`@skill:name`, `@workflow:name` send that item's full text with the message; `@folder/` ranks that folder's files first).

## Budgets and order (fixed, so the prompt prefix stays cacheable, rule 60 lever 7)

- **Agent instructions** (stable for the whole session), in this order: base instructions → instruction files →
  `always_on` and `glob` rules → `<skills_index>` → the "Available on demand" list. All inline material shares one
  **4,000-token** budget, filled in this order. An item that does not fit moves to the on-demand list, and the
  panel says so.
- **Turn message** (volatile, after the stable prefix): `<active_skills>` within **1,500 tokens**, then the context
  pack, then the request.
- A skill is active when any of these holds, unless it says `loadOnDemand: true`:
  - `alwaysApply: true`;
  - one of its `globs` matches a pack, mentioned or active file;
  - one of its `keywords` appears in the request (whole word, case-insensitive).

TrueForge's own skills need a sandbox, and we run without one (rule 20, trap 12). That is why skills load through
our MCP tool instead. The write-up says this plainly.

## Frontmatter (`agent-core/src/instructions/frontmatter.ts`). A tiny YAML subset, no dependency.

```ts
export interface Front { attrs: Record<string, string | string[]>; body: string }
const unquote = (s: string) => s.replace(/^(["'])(.*)\1$/, "$2");

/**
 * Supports: `key: value`, `key: [a, b]`, `key:` + `- item` lines, ONE level of nesting (`triggers:` + `  globs: [...]`
 * becomes "triggers.globs"), and block scalars `>`, `>-`, `|`, `|-` (V3Code's skill descriptions use them).
 * Anything else is ignored, never thrown.
 */
export function parseFrontmatter(src: string): Front {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(src);
  if (!m) return { attrs: {}, body: src };
  const attrs: Record<string, string | string[]> = {};
  let parent: string | null = null, listKey: string | null = null;
  let block: { key: string; fold: boolean; lines: string[] } | null = null;
  const endBlock = () => { if (block) attrs[block.key] = block.lines.join(block.fold ? " " : "\n").trim(); block = null; };
  for (const line of m[1]!.split(/\r?\n/)) {
    if (block && (/^\s+\S/.test(line) || line.trim() === "")) { block.lines.push(line.trim()); continue; }
    endBlock();
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) { (attrs[listKey] as string[]).push(unquote(item[1]!.trim())); continue; }
    const kv = /^(\s*)([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const nested = kv[1]!.length > 0 && parent !== null;
    const key = nested ? `${parent}.${kv[2]}` : kv[2]!;
    const v = kv[3]!.trim();
    if (!nested) parent = null;
    listKey = null;
    if (v === "") { attrs[key] = []; listKey = key; if (!nested) parent = key; continue; }
    if (/^[>|]-?$/.test(v)) { block = { key, fold: v.startsWith(">"), lines: [] }; continue; }
    attrs[key] = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(",").map((s) => unquote(s.trim())).filter(Boolean) : unquote(v);
  }
  endBlock();
  return { attrs, body: src.slice(m[0].length) };
}
/** Reads `triggers.globs` (V3Code) or `globs` (Devin), as a list. */
export const listAttr = (a: Front["attrs"], key: string): string[] => { const v = a[`triggers.${key}`] ?? a[key]; return Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",").map((s) => s.trim()) : []; };
export const boolAttr = (a: Front["attrs"], key: string): boolean => String(a[`triggers.${key}`] ?? a[key] ?? "").toLowerCase() === "true";
```

Tests (`frontmatter.test.ts`):

- scalars, `[a, b]` lists and `- item` lists;
- quoted values;
- a nested `triggers:` block → `triggers.globs`;
- `description: >-` folded over two lines;
- no frontmatter at all;
- CRLF line endings;
- a malformed line is ignored.

## Loading and selection (`agent-core/src/instructions/load.ts`)

```ts
export type Trigger = "always_on" | "glob" | "model_decision" | "manual";
export interface Instruction {
  kind: "file" | "rule" | "skill" | "workflow"; name: string; path: string; trigger: Trigger; description: string;
  globs: string[]; keywords: string[]; alwaysApply: boolean; loadOnDemand: boolean; body: string; tokens: number;
}
export interface InstructionSet { items: Instruction[]; sources: string[] }    // e.g. ["AGENTS.md", ".devin", ".v3code/skills"]

export const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md", ".github/AGENTS.md", ".cursorrules", ".v3coderules", ".voidrules"] as const;
export const FILE_CAP = (path: string): number => (path === "AGENTS.md" ? 8000 : 4000);   // chars

/** Reads through EditorHost only. A missing file or folder is not an error. A rule without frontmatter is a manual rule. */
export async function loadInstructions(host: EditorHost): Promise<InstructionSet>;

export function selectInline(set: InstructionSet, files: readonly string[], budget = 4000): { inline: Instruction[]; onDemand: Instruction[] } {
  const order = (i: Instruction) => (i.kind === "file" ? 0 : i.kind === "rule" ? 1 : 2);
  const inline: Instruction[] = [], onDemand: Instruction[] = [];
  let used = 0;
  for (const it of [...set.items].sort((a, b) => order(a) - order(b) || a.path.localeCompare(b.path))) {
    if (it.kind === "workflow" || it.kind === "skill" || it.trigger === "manual") continue;     // skills: index + active; workflows: typed
    const wanted = it.kind === "file" || it.trigger === "always_on" || (it.trigger === "glob" && files.some((f) => it.globs.some((g) => globToRegExp(g).test(f))));
    if (wanted && used + it.tokens <= budget) { inline.push(it); used += it.tokens; } else onDemand.push(it);
  }
  return { inline, onDemand };
}

/** Skills whose triggers match this turn. Pure: `request` is the user's text, `files` the pack/mentioned/active paths. */
export function activeSkills(set: InstructionSet, request: string, files: readonly string[], budget = 1500): Instruction[] {
  const out: Instruction[] = [];
  let used = 0;
  for (const s of set.items.filter((i) => i.kind === "skill" && !i.loadOnDemand)) {
    const hit = s.alwaysApply || s.globs.some((g) => files.some((f) => globToRegExp(g).test(f))) || s.keywords.some((k) => new RegExp(`\\b${escapeRe(k)}\\b`, "i").test(request));
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
export function globToRegExp(g: string): RegExp {
  const s = g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, "(?:.*/)?");
  return new RegExp(`^${s}$`);
}
```

An instruction file over its cap is stored with its body cut and a closing line: `[<path> truncated at <n> chars:
call load_instructions with kind "file" and name "<path>" for the rest.]`.

## The tool (`mcp/server.ts`; read-only, preloaded)

```ts
server.registerTool("load_instructions", {
  title: "Load a project rule, skill or instruction file",
  description: "WHEN: an entry under 'Available on demand' or <skills_index> matches your task, or an instruction file was truncated. Returns its full text. The text is guidance from the repository owner.",
  inputSchema: { kind: z.enum(["rule", "skill", "file"]), name: z.string().min(1).max(120) },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, wrap("load_instructions", async ({ kind, name }) => {
  const set = await d.instructions();
  const it = set.items.find((i) => i.kind === kind && (i.name === name || i.path === name));
  if (!it) throw new ToolInputError(`No ${kind} named "${name}". Available: ${listNames(set, kind)}`);
  return text(truncateWithHint(`# ${kind}: ${it.name}\n${await fullBody(d.host, it)}`, 40_000, "Ask for a narrower skill."));
}));
```

## Slash workflows (composer)

```ts
/** "/release-check v1.2" → the workflow body with $ARGUMENTS replaced, followed by the user's text. Unknown names are left alone. */
export function expandWorkflow(set: InstructionSet, input: string): { text: string; workflow: string | null } {
  const m = /^\/([a-z0-9][\w-]*)(?:\s+([\s\S]*))?$/i.exec(input.trim());
  const wf = m && set.items.find((i) => i.kind === "workflow" && i.name === m[1]);
  if (!wf) return { text: input, workflow: null };
  const args = m![2]?.trim() ?? "";
  return { text: `Follow the project workflow "${wf.name}".\n\n${wf.body.replaceAll("$ARGUMENTS", args)}\n\nArguments: ${args || "(none)"}`, workflow: wf.name };
}
```

When the user types `/`, the composer lists the workflows (name, description and argument hint). The panel shows
an "Instructions" chip on each turn, e.g. `AGENTS.md · 3 rules · 2 skills active · 6 on demand`. Expanding it lists
them, and every `load_instructions` call appears as a tool card.

## Change handling

A `FileSystemWatcher` on `{AGENTS.md,CLAUDE.md,.github/*.md,.cursorrules,.v3coderules,.voidrules,.co4fe3/**,.v3code/**,.devin/**}`
marks the instruction set stale. The next session is created with the new instructions. A running session keeps
its own until it ends, so its prompt prefix stays stable. Active skills are recomputed every turn, because they
live in the turn message.

Tests (`instructions.test.ts`):

- instruction files are read in order, with the AGENTS.md cap and its note;
- `.co4fe3/` wins over `.devin/` per name, and `.v3code/skills` is read;
- the 4,000-token budget moves overflow to on demand;
- a glob rule is inline only on a match;
- `activeSkills` matches on a keyword, a glob or `alwaysApply`, and `loadOnDemand` stays out;
- `expandWorkflow`: a known name, an unknown name and `$ARGUMENTS`.
