---
trigger: always_on
description: How the product reads the user's AGENTS.md, rules, workflows and skills (Devin-compatible formats), what goes inline versus on demand, the load_instructions tool, and slash workflows
---

# Project instructions inside co4fe3 (the product feature, not this pack)

co4fe3 reads the same files Devin reads, so a repository that already has a Devin pack works unchanged.

| File | Found at (first hit wins per kind) | Frontmatter | How it reaches the agent |
|---|---|---|---|
| `AGENTS.md` | workspace root | none | always inline (up to 1,500 tokens; the rest via `load_instructions`) |
| rules | `.co4fe3/rules/*.md`, else `.devin/rules/*.md` | `trigger`, `description`, `globs` | `always_on` → inline; `glob` → inline when a pack/mentioned/active file matches; `model_decision` → listed by description, loaded on demand; `manual` → only via `@rule:name` |
| skills | `.co4fe3/skills/<name>/SKILL.md`, else `.devin/skills/<name>/SKILL.md` | `name`, `description` | listed by description, loaded on demand |
| workflows | `.co4fe3/workflows/*.md`, else `.devin/workflows/*.md` | `description`, `argument-hint` | `/name args` in the composer expands the body into the request |

Inline rules share a 2,500-token budget, filled in file-name order (so `00-…` comes first). A rule that does not
fit is moved to the on-demand index and the panel says so. **The order inside the agent's instructions is fixed:**
base instructions → `AGENTS.md` → inline rules → the on-demand index. It never changes within a session, so the
prompt prefix stays cacheable (rule 60).

TrueForge's own skills need a sandbox, and we run without one (rule 20, trap 12). That is why skills load through
our MCP tool instead. The write-up says this plainly.

## Frontmatter (`agent-core/src/instructions/frontmatter.ts`). A tiny YAML subset, no dependency.

```ts
export interface Front { attrs: Record<string, string | string[]>; body: string }
const unquote = (s: string) => s.replace(/^(["'])(.*)\1$/, "$2");

/** `key: value`, `key: [a, b]`, and `key:` followed by `- item` lines. Anything else is ignored, never thrown. */
export function parseFrontmatter(src: string): Front {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(src);
  if (!m) return { attrs: {}, body: src };
  const attrs: Record<string, string | string[]> = {};
  let list: string | null = null;
  for (const line of m[1]!.split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && list) { (attrs[list] as string[]).push(unquote(item[1]!.trim())); continue; }
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!, v = kv[2]!.trim();
    if (v === "") { attrs[key] = []; list = key; continue; }
    list = null;
    attrs[key] = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(",").map((s) => unquote(s.trim())).filter(Boolean) : unquote(v);
  }
  return { attrs, body: src.slice(m[0].length) };
}
```

## Loading and selection (`agent-core/src/instructions/load.ts`)

```ts
export type Trigger = "always_on" | "glob" | "model_decision" | "manual";
export interface Instruction { kind: "agents" | "rule" | "skill" | "workflow"; name: string; path: string; trigger: Trigger; description: string; globs: string[]; body: string; tokens: number }
export interface InstructionSet { items: Instruction[]; source: ".co4fe3" | ".devin" | "none" }

/** Reads through EditorHost only. A missing folder is not an error. A file without frontmatter is a manual rule. */
export async function loadInstructions(host: EditorHost): Promise<InstructionSet>;

export function selectInline(set: InstructionSet, files: readonly string[], budget = 2500): { inline: Instruction[]; onDemand: Instruction[] } {
  const inline: Instruction[] = [], onDemand: Instruction[] = [];
  let used = 0;
  for (const it of [...set.items].sort((a, b) => a.path.localeCompare(b.path))) {
    const wanted = it.kind === "agents" || it.trigger === "always_on" || (it.trigger === "glob" && files.some((f) => it.globs.some((g) => globToRegExp(g).test(f))));
    if (it.kind === "workflow" || it.trigger === "manual") continue;          // workflows are typed; manual rules are mentioned
    if (wanted && used + it.tokens <= budget) { inline.push(it); used += it.tokens; } else onDemand.push(it);
  }
  return { inline, onDemand };
}

export function renderInstructions(base: string, sel: { inline: Instruction[]; onDemand: Instruction[] }): string {
  const parts = [base];
  for (const it of sel.inline) parts.push(`\n## Project ${it.kind === "agents" ? "guide (AGENTS.md)" : `rule: ${it.name}`}\n${it.body.trim()}`);
  if (sel.onDemand.length) parts.push(`\n## Available on demand (call load_instructions with kind and name)\n${sel.onDemand.map((i) => `- ${i.kind} ${i.name}: ${i.description || "(no description)"}`).join("\n")}`);
  return parts.join("\n");
}

/** "**" spans folders, "*" stays within one, "?" is one char. Anchored to the whole workspace-relative path. */
export function globToRegExp(g: string): RegExp {
  const s = g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, "(?:.*/)?");
  return new RegExp(`^${s}$`);
}
```

## The tool (`mcp/server.ts`; read-only, preloaded)

```ts
server.registerTool("load_instructions", {
  title: "Load a project rule or skill",
  description: "Load the full text of a project rule or skill listed under 'Available on demand'. Use it when the description matches the task. The text is guidance from the repository owner.",
  inputSchema: { kind: z.enum(["rule", "skill"]), name: z.string().min(1).max(80) },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async ({ kind, name }) => {
  const it = (await deps.instructions()).items.find((i) => i.kind === kind && i.name === name);
  return it ? text(`# ${kind}: ${name}\n${it.body}`) : toolError(`No ${kind} named "${name}". Available: ${listNames(await deps.instructions(), kind)}`);
});
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
an "Instructions" chip on each turn, e.g. `AGENTS.md · 3 rules inline · 6 on demand`. Expanding it lists them, and
every `load_instructions` call appears as a tool card.

## Change handling

A `FileSystemWatcher` on `{AGENTS.md,.co4fe3/**,.devin/**}` marks the instruction set stale. The next session is
created with the new instructions. A running session keeps its own until it ends, so its prompt prefix stays stable.
