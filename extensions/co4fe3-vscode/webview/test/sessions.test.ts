import { describe, it, expect } from "vitest";
import { organizeSessions, searchTerms, matchesTerms, matchRanges, dateBucket, compareSessions, sessionDetail, directionLabels, filterCounts, snippet, resultLine, type SessionQuery } from "../src/sessions.js";
import type { SessionSummary } from "@co4fe3/agent-core/panel";

// "now" is Friday 20 Nov 2026, 15:00 local. Times are built from local calendar parts, so the buckets hold in any time zone.
const at = (day: number, hour = 12, month = 10): number => new Date(2026, month, day, hour).getTime();
const NOW = at(20, 15);
let n = 0;
const s = (over: Partial<SessionSummary> = {}): SessionSummary => ({ id: `s${++n}-abcd`, title: `Session ${n}`, updatedAt: at(20, 10), running: false, createdAt: at(20, 9), pinned: false, archived: false, renamed: false, model: "", turns: 1, edits: 0, preview: "", ...over });
const Q: SessionQuery = { query: "", filter: "all", sort: "updated", desc: true, group: "none" };
const titles = (xs: SessionSummary[]): string[] => xs.map((x) => x.title);
const flat = (o: ReturnType<typeof organizeSessions>): string[] => o.groups.flatMap((g) => titles(g.items));

describe("search", () => {
  it("words are lower-cased and split; every word must match the title, model or first message", () => {
    expect(searchTerms("  Fix   REDIRECT ")).toEqual(["fix", "redirect"]);
    const a = s({ title: "Fix the redirect", model: "nvidia-nim/nemotron-super", preview: "why does url_for add a slash" });
    expect(matchesTerms(a, searchTerms("redirect"))).toBe(true);
    expect(matchesTerms(a, searchTerms("fix slash"))).toBe(true);        // one word in the title, one in the first message
    expect(matchesTerms(a, searchTerms("nemotron"))).toBe(true);         // the model
    expect(matchesTerms(a, searchTerms("fix banana"))).toBe(false);
    expect(matchesTerms(a, [])).toBe(true);
  });
  it("highlight ranges are merged and never overlap", () => {
    expect(matchRanges("Fix the fixture", ["fix"])).toEqual([[0, 3], [8, 11]]);
    expect(matchRanges("redirects", ["redirect", "direct", "rects"])).toEqual([[0, 9]]);
    expect(matchRanges("abc", ["zzz"])).toEqual([]); expect(matchRanges("abc", [])).toEqual([]);
    expect(matchRanges("aaa", ["aa"])).toEqual([[0, 2]]);
  });
  it("searching narrows the list and the counts say so", () => {
    const all = [s({ title: "Redirects" }), s({ title: "Tests" }), s({ title: "More redirects" })];
    const o = organizeSessions(all, { ...Q, query: "redirect" }, NOW);
    expect(flat(o).sort()).toEqual(["More redirects", "Redirects"]);
    expect(o).toMatchObject({ shown: 2, total: 3 });
    expect(organizeSessions(all, { ...Q, query: "zzz" }, NOW)).toMatchObject({ groups: [], shown: 0, total: 3 });
  });
});

describe("filter", () => {
  const pinned = s({ title: "P", pinned: true }), running = s({ title: "R", running: true }), edited = s({ title: "E", edits: 2 }), plain = s({ title: "X" }), arch = s({ title: "A", archived: true });
  const all = [pinned, running, edited, plain, arch];
  it("archived sessions are hidden everywhere except the Archived filter", () => {
    expect(flat(organizeSessions(all, Q, NOW))).not.toContain("A");
    expect(flat(organizeSessions(all, { ...Q, filter: "archived" }, NOW))).toEqual(["A"]);
  });
  it("Pinned, Running and Edited each keep only theirs", () => {
    expect(flat(organizeSessions(all, { ...Q, filter: "pinned" }, NOW))).toEqual(["P"]);
    expect(flat(organizeSessions(all, { ...Q, filter: "running" }, NOW))).toEqual(["R"]);
    expect(flat(organizeSessions(all, { ...Q, filter: "edited" }, NOW))).toEqual(["E"]);
  });
  it("the total is the size of the view the filter looks at, not of the whole list", () => {
    expect(organizeSessions(all, { ...Q, filter: "pinned" }, NOW)).toMatchObject({ shown: 1, total: 4 });
    expect(organizeSessions(all, { ...Q, filter: "archived" }, NOW)).toMatchObject({ shown: 1, total: 1 });
  });
  it("a search and a filter work together", () => {
    const xs = [s({ title: "Alpha", edits: 1 }), s({ title: "Beta", edits: 1 }), s({ title: "Alpha two" })];
    expect(flat(organizeSessions(xs, { ...Q, filter: "edited", query: "alpha" }, NOW))).toEqual(["Alpha"]);
  });
});

describe("pinned", () => {
  it("pinned sessions form the first group and are not repeated below", () => {
    const xs = [s({ title: "old pinned", pinned: true, updatedAt: at(1) }), s({ title: "new", updatedAt: at(20) }), s({ title: "old", updatedAt: at(2) })];
    const o = organizeSessions(xs, Q, NOW);
    expect(o.groups.map((g) => g.title)).toEqual(["Pinned", "Sessions"]);
    expect(flat(o)).toEqual(["old pinned", "new", "old"]);
    expect(new Set(flat(o)).size).toBe(3);
  });
  it("with nothing pinned there is no header at all", () => {
    const o = organizeSessions([s({ title: "a" }), s({ title: "b" })], Q, NOW);
    expect(o.groups).toHaveLength(1); expect(o.groups[0]!.title).toBe("");
  });
  it("pinned stays first when grouping by date, and is sorted like everything else", () => {
    const xs = [s({ title: "p1", pinned: true, updatedAt: at(3) }), s({ title: "p2", pinned: true, updatedAt: at(19) }), s({ title: "t", updatedAt: at(20, 11) })];
    const o = organizeSessions(xs, { ...Q, group: "date" }, NOW);
    expect(o.groups.map((g) => g.id)).toEqual(["pinned", "date:today"]);
    expect(titles(o.groups[0]!.items)).toEqual(["p2", "p1"]);
  });
});

describe("sort", () => {
  const a = s({ title: "banana", updatedAt: at(10), createdAt: at(1), turns: 5 }), b = s({ title: "Apple 10", updatedAt: at(12), createdAt: at(3), turns: 1 }), c = s({ title: "apple 2", updatedAt: at(11), createdAt: at(2), turns: 9 });
  const run = (sort: SessionQuery["sort"], desc: boolean): string[] => flat(organizeSessions([a, b, c], { ...Q, sort, desc }, NOW));
  it("by last update, newest first and oldest first", () => { expect(run("updated", true)).toEqual(["Apple 10", "apple 2", "banana"]); expect(run("updated", false)).toEqual(["banana", "apple 2", "Apple 10"]); });
  it("by creation time", () => { expect(run("created", true)).toEqual(["Apple 10", "apple 2", "banana"]); expect(run("created", false)).toEqual(["banana", "apple 2", "Apple 10"]); });
  it("by name, ignoring case and counting numbers as numbers", () => { expect(run("name", false)).toEqual(["apple 2", "Apple 10", "banana"]); expect(run("name", true)).toEqual(["banana", "Apple 10", "apple 2"]); });
  it("by number of messages", () => { expect(run("turns", true)).toEqual(["apple 2", "banana", "Apple 10"]); });
  it("ties fall back to the more recent, then to a stable order", () => {
    const x = s({ turns: 2, updatedAt: at(5) }), y = s({ turns: 2, updatedAt: at(9) });
    expect(compareSessions(x, y, "turns", true)).toBeGreaterThan(0);
    expect(compareSessions(x, x, "turns", true)).toBe(0);
  });
});

describe("group by date", () => {
  it("buckets by calendar day in the local zone, today first", () => {
    expect(dateBucket(at(20, 0), NOW).id).toBe("date:today"); expect(dateBucket(at(19, 23), NOW).id).toBe("date:yesterday");
    expect(dateBucket(at(14, 8), NOW).id).toBe("date:week"); expect(dateBucket(at(13, 23), NOW).id).toBe("date:month");
    expect(dateBucket(at(22, 8, 9), NOW).id).toBe("date:month"); expect(dateBucket(at(20, 8, 9), NOW).id).toBe("date:older");
    const xs = [s({ title: "old", updatedAt: at(1, 12, 8) }), s({ title: "now", updatedAt: at(20, 14) }), s({ title: "yday", updatedAt: at(19, 9) })];
    expect(organizeSessions(xs, { ...Q, group: "date" }, NOW).groups.map((g) => g.title)).toEqual(["Today", "Yesterday", "Older"]);
  });
  it("reversing the order puts the oldest group first", () => {
    const xs = [s({ updatedAt: at(1, 12, 8) }), s({ updatedAt: at(20, 14) })];
    expect(organizeSessions(xs, { ...Q, group: "date", desc: false }, NOW).groups.map((g) => g.title)).toEqual(["Older", "Today"]);
  });
  it("grouping follows the sort key: by creation time, a session created long ago but used today is old", () => {
    const x = s({ title: "x", createdAt: at(1, 12, 8), updatedAt: at(20, 14) });
    expect(organizeSessions([x], { ...Q, group: "date", sort: "created" }, NOW).groups[0]!.id).toBe("date:older");
    expect(organizeSessions([x], { ...Q, group: "date", sort: "updated" }, NOW).groups[0]!.id).toBe("date:today");
  });
});

describe("group by model and status", () => {
  it("models alphabetically with the short name, sessions without a model last", () => {
    const xs = [s({ model: "nvidia-nim/nemotron-super" }), s({ model: "google-gemini/gemini-flash-lite" }), s({ model: "" })];
    expect(organizeSessions(xs, { ...Q, group: "model" }, NOW).groups.map((g) => g.title)).toEqual(["gemini-flash-lite", "nemotron-super", "No model"]);
  });
  it("status: running, changed files, questions only", () => {
    const xs = [s({ title: "q" }), s({ title: "e", edits: 3 }), s({ title: "r", running: true, edits: 1 })];
    const o = organizeSessions(xs, { ...Q, group: "status" }, NOW);
    expect(o.groups.map((g) => g.title)).toEqual(["Running", "Changed files", "Questions only"]);
    expect(titles(o.groups[0]!.items)).toEqual(["r"]);
  });
  it("empty groups are not shown, and an empty list gives no groups", () => {
    expect(organizeSessions([s({ edits: 1 })], { ...Q, group: "status" }, NOW).groups.map((g) => g.id)).toEqual(["status:edits"]);
    expect(organizeSessions([], Q, NOW)).toEqual({ groups: [], shown: 0, total: 0 });
  });
});

describe("small helpers", () => {
  it("tooltip detail and direction labels", () => {
    expect(sessionDetail(s({ model: "nvidia-nim/nemotron-super", turns: 2, edits: 1 }))).toBe("nemotron-super · 2 messages · 1 change applied");
    expect(sessionDetail(s({ turns: 1 }))).toBe("1 message");
    expect(directionLabels("name")).toEqual({ desc: "Z to A", asc: "A to Z" }); expect(directionLabels("updated").desc).toBe("Newest first");
  });
  it("does not change the list it is given", () => {
    const xs = [s({ title: "b", updatedAt: at(1) }), s({ title: "a", updatedAt: at(2) })];
    const copy = JSON.stringify(xs);
    organizeSessions(xs, { ...Q, sort: "name", desc: false }, NOW);
    expect(JSON.stringify(xs)).toBe(copy);
  });
});

describe("filter counts and result lines", () => {
  it("counts what each filter would show; archived sessions count only under Archived", () => {
    const all = [s({ pinned: true }), s({ running: true, edits: 1 }), s({ edits: 3 }), s(), s({ archived: true }), s({ archived: true, edits: 2 })];
    expect(filterCounts(all)).toEqual({ all: 4, pinned: 1, running: 1, edited: 2, archived: 2 });
    expect(filterCounts([])).toEqual({ all: 0, pinned: 0, running: 0, edited: 0, archived: 0 });
  });
  it("a snippet is the text around the first word, trimmed with ellipses, and short text is kept whole", () => {
    expect(snippet("  a  b\n c ", ["zzz"])).toBe("a b c");
    const long = `${"x ".repeat(60)}NEEDLE ${"y ".repeat(60)}`;
    const out = snippet(long, ["needle"], 40);
    expect(out).toContain("NEEDLE"); expect(out.startsWith("…")).toBe(true); expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(42);
    expect(snippet("needle at the very start " + "z".repeat(200), ["needle"], 40).startsWith("needle")).toBe(true);
    expect(snippet("z".repeat(200), ["nope"], 40)).toHaveLength(41);          // no match: the beginning, with a trailing ellipsis
  });
  it("the line under a result shows where the match is, and nothing when the title already says it", () => {
    const a = s({ title: "Tour", preview: "explain how blueprints register routes", model: "nvidia-nim/nemotron-super" });
    expect(resultLine(a, [])).toBe("");
    expect(resultLine(a, ["tour"])).toBe("");
    expect(resultLine(a, ["blueprints"])).toBe("explain how blueprints register routes");
    expect(resultLine(a, ["nemotron"])).toBe("nemotron-super");
    expect(resultLine(s({ title: "Tour", preview: "x", model: "" }), ["zzz"])).toBe("");
  });
});
