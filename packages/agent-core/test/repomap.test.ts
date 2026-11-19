import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { indexFile, buildIndex, rankFiles, personalizedPageRank, queryTerms, termMatches, rarestTerms } from "../src/context/repomap.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fixtures/minipkg");
const read = (rel: string) => readFileSync(join(FIX, rel), "utf8");

const miniIndex = () =>
  buildIndex([
    indexFile("src/minipkg/cli.py", read("src/minipkg/cli.py")),
    indexFile("src/minipkg/helpers.py", read("src/minipkg/helpers.py")),
    indexFile("src/minipkg/__init__.py", read("src/minipkg/__init__.py")),
    indexFile("tests/test_cli.py", read("tests/test_cli.py")),
    indexFile("docs/cli.rst", read("docs/cli.rst")),
    indexFile("pyproject.toml", read("pyproject.toml")),
  ]);

const TASK_B = "Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking secret values. It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.";

describe("query terms", () => {
  it("splits snake and camel, drops stopwords, stems", () => {
    expect(queryTerms("add the flaskConfig command")).toEqual(["flask", "config", "command"]);
    expect(queryTerms("TESTING routes")).toEqual(["test", "rout"]);
  });
  it("termMatches shares a stem prefix of ≥ 3 chars", () => {
    expect(termMatches("test", "tests")).toBe(true);
    expect(termMatches("document", "docs")).toBe(true);    // "docs" → "doc"; "document" starts with it
    expect(termMatches("cli", "configuration")).toBe(false);
  });
});

describe("personalizedPageRank", () => {
  it("rank flows from users to definitions on a 4-node graph", () => {
    const nodes = ["a", "b", "c", "d"];
    const edges = new Map([
      ["a", new Map([["b", 1], ["c", 1]])],
      ["b", new Map([["c", 1]])],
    ]);
    const seed = new Map([["a", 1]]);
    const r = personalizedPageRank(nodes, edges, seed);
    expect(r.get("c")!).toBeGreaterThan(r.get("d")!);
    expect(r.get("b")!).toBeGreaterThan(r.get("d")!);
    expect([...r.values()].reduce((x, y) => x + y, 0)).toBeCloseTo(1, 5);
  });
});

describe("rankFiles on minipkg", () => {
  const ix = miniIndex();

  it("the Task-B-like query ranks cli.py, test_cli.py and docs/cli.rst in the top 5", () => {
    const top5 = rankFiles(ix, { text: TASK_B, mentioned: [], recent: [] }).slice(0, 5).map((r) => r.path);
    for (const want of ["src/minipkg/cli.py", "tests/test_cli.py", "docs/cli.rst"]) {
      expect(top5, `top5 ${JSON.stringify(top5)} should contain ${want}`).toContain(want);
    }
  });

  it("is deterministic", () => {
    const a = rankFiles(ix, { text: TASK_B, mentioned: [], recent: [] }).map((r) => r.path);
    const b = rankFiles(ix, { text: TASK_B, mentioned: [], recent: [] }).map((r) => r.path);
    expect(a).toEqual(b);
  });

  it("a missing grep channel still ranks", () => {
    const withGrep = rankFiles(ix, { text: TASK_B, mentioned: [], recent: [], grepHits: new Map([["tests/test_cli.py", 4]]) });
    expect(withGrep.length).toBeGreaterThan(0);
    expect(withGrep.find((r) => r.path === "tests/test_cli.py")!.ranks.grep).toBe(1);
  });

  it("an empty query with an active file still returns the active file first", () => {
    const r = rankFiles(ix, { text: "", mentioned: [], active: "src/minipkg/helpers.py", recent: [] });
    expect(r[0]!.path).toBe("src/minipkg/helpers.py");
  });

  it("each ranked file carries reasons and per-channel ranks", () => {
    const r = rankFiles(ix, { text: TASK_B, mentioned: [], recent: [] });
    const cli = r.find((x) => x.path === "src/minipkg/cli.py")!;
    expect(cli.why.length).toBeGreaterThan(0);
    expect(cli.why.at(-1)).toMatch(/lexical #\d/);
    expect(cli.ranks.lexical).toBeGreaterThan(0);
  });

  it("rarestTerms picks the highest-idf request terms", () => {
    const rare = rarestTerms(ix, TASK_B, 3);
    expect(rare.length).toBe(3);
    expect(rare).toContain("config");
  });
});

describe("structure in buildIndex", () => {
  it("files sharing a stem part get mutual edges (cli.py ↔ docs/cli.rst)", () => {
    const ix = buildIndex([
      indexFile("src/cli.py", "def command():\n    pass\n"),
      indexFile("docs/cli.rst", "Command Line Interface\n======================\n"),
      indexFile("other/zeta.py", "def z():\n    pass\n"),
    ]);
    expect(ix.graph.get("src/cli.py")?.has("docs/cli.rst")).toBe(true);
    expect(ix.graph.get("docs/cli.rst")?.has("src/cli.py")).toBe(true);
    expect(ix.graph.get("src/cli.py")?.has("other/zeta.py") ?? false).toBe(false);
  });

  it("a docs page's uses-edge is mutual at half weight", () => {
    const ix = buildIndex([
      indexFile("src/app.py", "class Widget:\n    pass\n"),
      indexFile("docs/guide.md", "# Using Widget\nThe Widget docs.\n"),
    ]);
    expect(ix.graph.get("docs/guide.md")?.get("src/app.py")).toBe(1);      // doc uses the symbol → code
    expect(ix.graph.get("src/app.py")?.get("docs/guide.md")).toBe(0.5);    // code → its doc page at half weight
  });
});
