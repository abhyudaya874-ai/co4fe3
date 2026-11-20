import { describe, it, expect } from "vitest";
import { indexFile, buildIndex } from "../src/context/repomap.js";
import { completeMention, completeSlash, matchScore } from "../src/context/complete.js";
import type { Instruction } from "../src/instructions/load.js";

const files = ["README.md", "CHANGES.rst", "pyproject.toml", "uv.lock", "src/flask/app.py", "src/flask/views.py", "src/flask/json/provider.py", "tests/test_views.py", "docs/views.rst"];
const ix = buildIndex([indexFile("src/flask/views.py", "class View:\n    pass\nclass MethodView(View):\n    pass\n"), indexFile("src/flask/app.py", "class Flask:\n    pass\n")]);
const instr = (kind: Instruction["kind"], name: string, description = ""): Instruction => ({ kind, name, path: `.co4fe3/${kind}s/${name}.md`, trigger: "manual", description, globs: [], keywords: [], alwaysApply: false, loadOnDemand: false, body: "b", tokens: 1 });
const instructions = [instr("rule", "style", "how we write Python"), instr("skill", "release", "cut a release"), instr("workflow", "ship-slice", "one slice")];

describe("the @ menu (Devin-style)", () => {
  it("an empty @ lists open files first, then top-level folders and files, then rules and skills", () => {
    const items = completeMention({ prefix: "", files, ix, instructions, open: ["src/flask/views.py"] });
    expect(items[0]).toMatchObject({ kind: "file", label: "views.py", detail: "src/flask", group: "Open files" });
    expect(items.filter((i) => i.kind === "folder").map((i) => i.insert)).toEqual(["docs/", "src/", "tests/"]);
    expect(items.some((i) => i.insert === "uv.lock")).toBe(true);                       // every file, not only indexed ones
    expect(items.filter((i) => i.group === "Rules & skills").map((i) => i.insert)).toEqual(["rule:style", "skill:release", "workflow:ship-slice"]);
    expect([...new Set(items.map((i) => i.group))]).toEqual(["Open files", "Files & folders", "Rules & skills"]);
  });
  it("typing ranks base-name hits first, offers folders and symbols, and matches rules by name", () => {
    const items = completeMention({ prefix: "view", files, ix, instructions, open: [] });
    expect(items.slice(0, 2).map((i) => i.insert).sort()).toEqual(["docs/views.rst", "src/flask/views.py"]);   // base-name prefix hits, shorter path first
    expect(items.findIndex((i) => i.insert === "tests/test_views.py")).toBeGreaterThan(1);
    expect(items.map((i) => i.insert)).toContain("docs/views.rst");
    expect(items.find((i) => i.kind === "symbol")).toMatchObject({ label: "View", insert: "symbol:View" });
    expect(completeMention({ prefix: "json", files, ix, instructions, open: [] })[0]).toMatchObject({ kind: "folder", insert: "src/flask/json/" });
    expect(completeMention({ prefix: "sty", files, ix, instructions, open: [] }).map((i) => i.insert)).toContain("rule:style");
  });
  it("matchScore: exact base name > prefix > contains > path segment > fuzzy > no match", () => {
    const s = (p: string) => matchScore(p, "app");
    expect(s("src/app")).toBeGreaterThan(s("src/apply.py"));
    expect(s("src/apply.py")).toBeGreaterThan(s("src/myapp.py"));
    expect(matchScore("src/flask/app.py", "sfa")).toBe(5);
    expect(matchScore("README.md", "zzz")).toBe(-1);
  });
  it("the / menu lists workflows, then skills", () => {
    expect(completeSlash(instructions, "").map((i) => [i.group, i.insert])).toEqual([["Workflows", "ship-slice"], ["Skills", "release"]]);
    expect(completeSlash(instructions, "rel").map((i) => i.insert)).toEqual(["release"]);
  });
});
