import { describe, it, expect } from "vitest";
import { pendingReview, toolLabel, bareToolName, splitPath, hunkLines, hunkDeltas, speedBars, seconds, tokens, modelSections, fileRef, hasOwnCard } from "../src/format.js";
import type { HunkView, ModelRow } from "@co4fe3/agent-core/panel";

describe("toolLabel", () => {
  it("names what the tool acted on, from the arguments", () => {
    expect(toolLabel("read_file", '{"path":"src/flask/cli.py","offset":120,"limit":40}')).toMatchObject({ verb: "Read", target: "src/flask/cli.py:120-159", icon: "file" });
    expect(toolLabel("read_file", '{"path":"a.py"}').target).toBe("a.py");
    expect(toolLabel("search_workspace", '{"pattern":"redirect"}')).toMatchObject({ verb: "Search", target: "redirect" });
    expect(toolLabel("pack_context", '{"path":"src/a.py","symbol":"Flask"}').target).toBe("Flask in src/a.py");
    expect(toolLabel("propose_edit", '{"path":"src/a.py","why":"x"}')).toMatchObject({ verb: "Edit", target: "src/a.py", icon: "edit" });
    expect(toolLabel("run_command", '{"command":"pytest -q"}')).toMatchObject({ verb: "Command", target: "pytest -q", icon: "terminal" });
  });
  it("survives partial JSON while the arguments stream, and unknown tools", () => {
    expect(toolLabel("read_file", '{"path":"src/fl')).toMatchObject({ verb: "Read", target: "" });
    expect(toolLabel("read_file", "")).toMatchObject({ verb: "Read" });
    expect(toolLabel("some_new_tool", "{}")).toMatchObject({ verb: "Some new tool", icon: "tool" });
    expect(toolLabel("x", "[1,2]")).toMatchObject({ verb: "X" });
  });
  it("bare names drop any server prefix", () => {
    expect(bareToolName("co4fe3-ws-ab12cd34/read_file")).toBe("read_file");
    expect(bareToolName("read_file")).toBe("read_file");
  });
  it("only the command tool has a card of its own that replaces its row", () => {
    expect(hasOwnCard("run_command")).toBe(true);
    expect(hasOwnCard("propose_edit")).toBe(false);
  });
});

describe("splitPath", () => {
  it("separates the folder from the file name", () => {
    expect(splitPath("src/flask/cli.py")).toEqual({ dir: "src/flask/", base: "cli.py" });
    expect(splitPath("README.md")).toEqual({ dir: "", base: "README.md" });
  });
});

describe("diff lines", () => {
  // before: 1..6, line 3 → THREE, and a line is added after 6 (second hunk)
  const h1: HunkView = { id: "h1", oldStart: 2, oldLines: ["three"], newLines: ["THREE", "3b"], before: ["one", "two"], after: ["four", "five"] };
  const h2: HunkView = { id: "h2", oldStart: 6, oldLines: [], newLines: ["seven"], before: ["five", "six"], after: [] };
  it("numbers context and changes in the old and the new file", () => {
    const l = hunkLines(h1, 0);
    expect(l.map((x) => x.kind)).toEqual(["ctx", "ctx", "del", "add", "add", "ctx", "ctx"]);
    expect(l[0]).toMatchObject({ text: "one", oldNo: 1, newNo: 1 });
    expect(l[2]).toMatchObject({ kind: "del", text: "three", oldNo: 3 });
    expect(l[3]).toMatchObject({ kind: "add", text: "THREE", newNo: 3 });
    expect(l[4]).toMatchObject({ kind: "add", text: "3b", newNo: 4 });
    expect(l[5]).toMatchObject({ text: "four", oldNo: 4, newNo: 5 });          // one line was added above it
  });
  it("a later hunk is shifted by what the earlier ones added", () => {
    expect(hunkDeltas([h1, h2])).toEqual([0, 1]);
    const l = hunkLines(h2, 1);
    expect(l.find((x) => x.kind === "add")).toMatchObject({ text: "seven", newNo: 8 });
    expect(l[0]).toMatchObject({ text: "five", oldNo: 5, newNo: 6 });
  });
  it("a hunk at the top of the file has fewer context lines and still numbers from 1", () => {
    const top: HunkView = { id: "h1", oldStart: 0, oldLines: ["a"], newLines: ["A"], before: [], after: ["b"] };
    const l = hunkLines(top, 0);
    expect(l[0]).toMatchObject({ kind: "del", oldNo: 1 });
    expect(l[1]).toMatchObject({ kind: "add", newNo: 1 });
    expect(l[2]).toMatchObject({ kind: "ctx", oldNo: 2, newNo: 2 });
  });
});

describe("models", () => {
  const row = (name: string, o: Partial<ModelRow> = {}): ModelRow => ({ name, provider: name.split("/")[0]!, short: name.split("/")[1]!, p50Ms: null, ok: 0, failed: 0, benchedMin: null, contextLength: null, recent: false, ...o });
  it("speed bars follow the median time to first token", () => {
    expect([speedBars(null), speedBars(700), speedBars(2000), speedBars(9000)]).toEqual([0, 3, 2, 1]);
  });
  it("sections: fastest, recent, all; each model once; a search filters", () => {
    const rows = [row("g/flash", { p50Ms: 2040, recent: true }), row("n/super", { p50Ms: 740, recent: true }), row("n/ultra"), row("n/slow", { p50Ms: 30000 })];
    const s = modelSections(rows, "");
    expect(s.map((x) => x.id)).toEqual(["fast", "recent", "all"].filter((id) => s.some((x) => x.id === id)));
    expect(s[0]!.rows.map((r) => r.short)).toEqual(["super", "flash", "slow"]);
    const names = s.flatMap((x) => x.rows.map((r) => r.name));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(4);
    expect(modelSections(rows, "ULT").flatMap((x) => x.rows.map((r) => r.short))).toEqual(["ultra"]);
    expect(modelSections(rows, "zzz")).toEqual([]);
  });
  it("a benched model is not offered as fastest", () => {
    const s = modelSections([row("n/super", { p50Ms: 700, benchedMin: 5 })], "");
    expect(s.map((x) => x.id)).toEqual(["all"]);
  });
  it("formatting", () => {
    expect(seconds(740)).toBe("0.7 s"); expect(seconds(12_400)).toBe("12 s");
    expect(tokens(131072)).toBe("131K"); expect(tokens(1_048_576)).toBe("1M"); expect(tokens(900)).toBe("900");
  });
});

describe("fileRef (inline code that names a file)", () => {
  it("links paths and path:line, not prose", () => {
    expect(fileRef("src/flask/cli.py")).toEqual({ path: "src/flask/cli.py" });
    expect(fileRef("cli.py:42")).toEqual({ path: "cli.py", line: 42 });
    expect(fileRef("README.md")).toEqual({ path: "README.md" });
    for (const no of ["flask.Flask", "os.environ", "e.g.", "3.1.3", "self.x", "a b.py", "foo()", "--verbose", "x.y.z"]) expect(fileRef(no), no).toBeNull();
  });
});

describe("pendingReview (the bar above the composer)", () => {
  const card = (key: string, path: string, verdict: Record<string, "pending" | "accepted" | "rejected">, o: object = {}) =>
    ({ kind: "proposal" as const, key, path, why: "w", by: "lead", adds: 2, removes: 1, hunks: Object.keys(verdict).map((id) => ({ id, oldStart: 0, oldLines: [], newLines: [] })), verdict, ...o });
  it("counts the files still waiting, with their totals", () => {
    const r = pendingReview([card("k1", "a.py", { h1: "pending" }), card("k2", "b.py", { h1: "accepted", h2: "pending" }), card("k3", "a.py", { h1: "pending" })]);
    expect(r).toEqual({ keys: ["k1", "k2", "k3"], files: 2, adds: 6, removes: 3 });
  });
  it("applied, dropped and fully decided cards are not waiting; other rows are ignored", () => {
    const r = pendingReview([card("k1", "a.py", { h1: "accepted" }), card("k2", "b.py", { h1: "pending" }, { applied: { checkpointId: "c", newErrors: [] } }), card("k3", "c.py", { h1: "pending" }, { dropped: true }), { kind: "marker", id: "m", text: "x" }]);
    expect(r).toEqual({ keys: [], files: 0, adds: 0, removes: 0 });
  });
});
