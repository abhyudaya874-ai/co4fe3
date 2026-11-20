import { describe, it, expect } from "vitest";
import { loadInstructions, selectInline, activeSkills, skillsUsed, expandWorkflow, instructionMentions, globToRegExp, renderInstructions, renderActiveSkills, type InstructionSet } from "../src/instructions/load.js";
import type { EditorHost } from "../src/host.js";

/** An EditorHost over an in-memory file map — loadInstructions reads only through the host. */
function memHost(files: Record<string, string>): EditorHost {
  return {
    root: "/r",
    readText: async (rel) => files[rel] ?? null,
    listFiles: async () => Object.keys(files).filter((p) => !p.endsWith("/")).sort(),
    search: async () => [], run: async () => { throw new Error("no"); }, problems: async () => [],
    lsp: { documentSymbols: async () => [], references: async () => [], incomingCalls: async () => [], hover: async () => [] },
    now: () => 0,
  };
}

const md = (attrs: string, body: string): string => `---\n${attrs}\n---\n${body}`;

describe("loadInstructions / selectInline / activeSkills / expandWorkflow (rule 85)", () => {
  it("reads instruction files in order, caps AGENTS.md at 8,000 chars with the note", async () => {
    const set = await loadInstructions(memHost({ "AGENTS.md": "x".repeat(9000), "CLAUDE.md": "short" }));
    const agents = set.items.find((i) => i.name === "AGENTS.md")!;
    expect(agents.body).toContain("truncated at 8000 chars");
    expect(agents.body).toContain('kind "file" and name "AGENTS.md"');
    expect(set.items.find((i) => i.name === "CLAUDE.md")!.body).toBe("short");
    expect(set.sources).toContain("AGENTS.md");
  });

  it(".co4fe3 wins over .devin per name (rule 85: first hit wins); .v3code/skills is read", async () => {
    const set = await loadInstructions(memHost({
      ".co4fe3/rules/a.md": md("trigger: always_on", "co4fe3 rule A"),
      ".devin/rules/a.md": md("trigger: always_on", "devin rule A loses the name"),
      ".devin/rules/b.md": md("trigger: always_on", "devin rule B"),
      ".co4fe3/workflows/ship.md": md("description: ours", "our ship"),
      ".devin/workflows/ship.md": md("description: theirs", "their ship"),
      ".v3code/skills/v3sk/SKILL.md": md("name: v3sk\ndescription: from v3code", "v3 skill body"),
    }));
    expect(set.items.filter((i) => i.kind === "rule").map((i) => i.path)).toEqual([".co4fe3/rules/a.md", ".devin/rules/b.md"]);
    expect(set.items.filter((i) => i.kind === "workflow").map((i) => i.body)).toEqual(["our ship"]);
    expect(selectInline(set, []).inline.map((i) => i.body)).toEqual(["co4fe3 rule A", "devin rule B"]);   // one copy inline, never two
    expect(set.items.find((i) => i.kind === "skill")).toMatchObject({ name: "v3sk", path: ".v3code/skills/v3sk/SKILL.md" });
  });

  it("reads what Devin reads: AGENT.md, AGENTS.local.md, .devin/global_rules.md, .windsurf rules, .agents/skills", async () => {
    const set = await loadInstructions(memHost({
      "AGENTS.md": "root", "AGENT.md": "singular", "AGENTS.local.md": "mine", ".devin/global_rules.md": "global",
      ".windsurf/rules/w.md": md("trigger: always_on", "windsurf rule"),
      ".agents/skills/deploy/SKILL.md": md("name: deploy-to-production\ndescription: deploy safely", "steps"),
      ".agents/skills/deploy/checklist.md": "supporting file, not a skill",
    }));
    expect(set.items.filter((i) => i.kind === "file").map((i) => i.name)).toEqual(["AGENTS.md", "AGENT.md", "AGENTS.local.md", ".devin/global_rules.md"]);
    expect(set.items.find((i) => i.kind === "rule")?.path).toBe(".windsurf/rules/w.md");
    expect(set.items.filter((i) => i.kind === "skill").map((i) => i.name)).toEqual(["deploy-to-production"]);   // frontmatter name; SKILL.md only
  });

  it("a sub-folder AGENTS.md applies only when the work touches that folder (Devin)", async () => {
    const set = await loadInstructions(memHost({ "AGENTS.md": "root", "src/flask/json/AGENTS.md": "json rules", "node_modules/x/AGENTS.md": "ignored" }));
    expect(set.items.map((i) => i.path)).toEqual(["AGENTS.md", "src/flask/json/AGENTS.md"]);
    expect(selectInline(set, ["src/flask/app.py"]).inline.map((i) => i.path)).toEqual(["AGENTS.md"]);
    expect(selectInline(set, ["src/flask/json/provider.py"]).inline.map((i) => i.path)).toEqual(["AGENTS.md", "src/flask/json/AGENTS.md"]);
  });

  it("@rule:name and @skill:name send that item's text with the message; /skill-name invokes a skill", async () => {
    const set = await loadInstructions(memHost({
      ".co4fe3/rules/style.md": md("trigger: manual\ndescription: house style", "Use type hints."),
      ".co4fe3/skills/review/SKILL.md": md("name: review\ndescription: review a diff", "Check the tests."),
    }));
    const r = instructionMentions(set, "tidy app.py with @rule:style and @skill:review, not @rule:nope");
    expect(r.loaded.map((i) => i.name)).toEqual(["style", "review"]);
    expect(r.text).toContain('<rule name="style" path=".co4fe3/rules/style.md">\nUse type hints.\n</rule>');
    expect(r.text).toContain("@rule:nope");
    expect(expandWorkflow(set, "/review the last commit")).toEqual({ text: 'Use the project skill "review".\n\nCheck the tests.\n\nRequest: the last commit', workflow: "review" });
  });

  it("the 4,000-token budget moves overflow to onDemand", async () => {
    const big = "x".repeat(4000 * 4);
    const set = await loadInstructions(memHost({
      "AGENTS.md": "small",
      ".devin/rules/r1.md": md("trigger: always_on", "a ".repeat(2500)),
      ".devin/rules/r2.md": md("trigger: always_on", "b ".repeat(2500)),
      ".devin/rules/r3.md": md("trigger: always_on", big),
    }));
    const sel = selectInline(set, []);
    expect(sel.inline.length + sel.onDemand.length).toBe(set.items.filter((i) => i.kind !== "skill" && i.kind !== "workflow" && i.trigger !== "manual").length);
    expect(sel.onDemand.some((i) => i.name === "r3")).toBe(true);
  });

  it("a glob rule is inline only on a match", async () => {
    const set = await loadInstructions(memHost({ ".devin/rules/g.md": md("trigger: glob\nglobs: [src/**.py]", "glob rule") }));
    expect(selectInline(set, ["src/x.py"]).inline).toHaveLength(1);
    expect(selectInline(set, ["docs/x.md"]).inline).toHaveLength(0);
    expect(selectInline(set, ["docs/x.md"]).onDemand).toHaveLength(1);
  });

  it("activeSkills matches keyword, glob or alwaysApply; loadOnDemand stays out", async () => {
    const set: InstructionSet = { sources: [], items: [
      { kind: "skill", name: "kw", path: ".devin/skills/kw/SKILL.md", trigger: "manual", description: "", globs: [], keywords: ["latency"], alwaysApply: false, loadOnDemand: false, body: "b", tokens: 10 },
      { kind: "skill", name: "gl", path: ".devin/skills/gl/SKILL.md", trigger: "manual", description: "", globs: ["src/**"], keywords: [], alwaysApply: false, loadOnDemand: false, body: "b", tokens: 10 },
      { kind: "skill", name: "aa", path: ".devin/skills/aa/SKILL.md", trigger: "manual", description: "", globs: [], keywords: [], alwaysApply: true, loadOnDemand: false, body: "b", tokens: 10 },
      { kind: "skill", name: "lod", path: ".devin/skills/lod/SKILL.md", trigger: "manual", description: "", globs: [], keywords: ["latency"], alwaysApply: false, loadOnDemand: true, body: "b", tokens: 10 },
    ] };
    const active = activeSkills(set, "check the latency here", ["src/x.py"]);
    expect(active.map((s) => s.name).sort()).toEqual(["aa", "gl", "kw"]);
  });

  it("expandWorkflow: known name, unknown name, $ARGUMENTS", async () => {
    const set = await loadInstructions(memHost({ ".devin/workflows/release-check.md": md("description: ship it", "Run $ARGUMENTS then report.") }));
    expect(expandWorkflow(set, "/release-check v1.2")).toEqual({ text: 'Follow the project workflow "release-check".\n\nRun v1.2 then report.\n\nArguments: v1.2', workflow: "release-check" });
    expect(expandWorkflow(set, "/nope x")).toEqual({ text: "/nope x", workflow: null });
    expect(expandWorkflow(set, "not a slash")).toEqual({ text: "not a slash", workflow: null });
  });

  it("globToRegExp: ** spans folders, * stays in one, ? is one char", () => {
    expect(globToRegExp(["src/**"])[0]!.test("src/a/b/c.py")).toBe(true);
    expect(globToRegExp(["src/*.py"])[0]!.test("src/a/b.py")).toBe(false);
    expect(globToRegExp(["src/*.py"])[0]!.test("src/a.py")).toBe(true);
    expect(globToRegExp(["a?c"])[0]!.test("abc")).toBe(true);
    expect(globToRegExp(["*.md"])[0]!.test("AGENTS.md")).toBe(true);
  });

  it("renderInstructions orders: files, rules, skills_index, on-demand", () => {
    const set: InstructionSet = { sources: [], items: [
      { kind: "file", name: "AGENTS.md", path: "AGENTS.md", trigger: "always_on", description: "", globs: [], keywords: [], alwaysApply: false, loadOnDemand: false, body: "AGENTS BODY", tokens: 10 },
      { kind: "rule", name: "r1", path: ".devin/rules/r1.md", trigger: "always_on", description: "", globs: [], keywords: [], alwaysApply: false, loadOnDemand: false, body: "RULE BODY", tokens: 10 },
      { kind: "skill", name: "sk", path: ".devin/skills/sk/SKILL.md", trigger: "manual", description: "the skill", globs: [], keywords: [], alwaysApply: false, loadOnDemand: false, body: "SK", tokens: 10 },
    ] };
    const sel = selectInline(set, []);
    const text = renderInstructions("BASE", sel, set.items.filter((i) => i.kind === "skill"));
    expect(text).toContain("AGENTS BODY");
    expect(text).toContain("RULE BODY");
    expect(text).toContain("<skills_index>");
    expect(text).toContain("- sk: the skill");
    expect(renderActiveSkills(set.items.filter((i) => i.kind === "skill"))).toContain("### sk");
  });
});

describe("skillsUsed: the skills that reach a turn, and why", () => {
  it("lists a matched, a mentioned and a slash-invoked skill once each, and lets a workflow of the same name win", async () => {
    const set = await loadInstructions(memHost({
      ".co4fe3/skills/flask-cli/SKILL.md": md("name: flask-cli\ndescription: CLI conventions\nkeywords: [cli]", "Use click."),
      ".co4fe3/skills/review/SKILL.md": md("name: review\ndescription: Review a change", "Check the tests."),
      ".co4fe3/skills/run/SKILL.md": md("name: run\ndescription: a skill named like a workflow", "x"),
      ".co4fe3/workflows/run.md": md("description: run tests", "Run $ARGUMENTS."),
    }));
    const skill = (n: string) => set.items.find((i) => i.kind === "skill" && i.name === n)!;
    const text = "Add a CLI command";
    const matched = skillsUsed(set, text, activeSkills(set, text, []), []);
    expect(matched.map((u) => u.name)).toEqual(["flask-cli"]);
    expect(matched[0]!.result).toContain("CLI conventions");
    expect(skillsUsed(set, "/review the last commit", [], []).map((u) => [u.name, u.result])).toEqual([["review", "Review a change\nInvoked with /review."]]);
    expect(skillsUsed(set, "see @skill:review", [], [skill("review")]).map((u) => u.name)).toEqual(["review"]);
    expect(skillsUsed(set, "/run tests/test_cli.py", [], [])).toEqual([]);                       // the workflow, not the skill
    expect(skillsUsed(set, "/review x @skill:review", [], [skill("review")]).map((u) => u.name)).toEqual(["review"]);   // once
  });
});
