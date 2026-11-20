import { renderToString as ssr } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { emptyChrome, defaultSidebar, type ChromeState, type SessionSummary, type SidebarPrefs } from "@co4fe3/agent-core/panel";
import { Sidebar, ShowSidebar } from "../src/components/Sidebar.js";
import { SessionList, Marked, type ListActions } from "../src/components/SessionList.js";
import { EditableTitle } from "../src/components/Rename.js";
import { organizeSessions } from "../src/sessions.js";

// The sidebar's states, rendered on the server. What needs a pointer or a keyboard (typing, drag, menus) is checked in the real editor.
const html = (n: ReactNode): string => ssr(n).replace(/<!-- -->/g, "");
const none = (): void => undefined;
const NOW = new Date(2026, 10, 20, 15).getTime();
let n = 0;
const sess = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  id: `s${++n}`, title: `Session ${n}`, updatedAt: NOW - 5 * 60_000, createdAt: NOW - 3_600_000, running: false, pinned: false, archived: false, renamed: false,
  model: "nvidia-nim/nemotron-super", turns: 2, edits: 0, preview: "first message", ...over,
});
const bar = (sessions: SessionSummary[], prefs: Partial<SidebarPrefs> = {}, chrome: Partial<ChromeState> = {}, activeId = sessions[0]?.id ?? ""): string =>
  html(<Sidebar sessions={sessions} activeId={activeId} chrome={{ ...emptyChrome(), layout: "agent", ...chrome, sidebar: { ...defaultSidebar(), ...prefs } }} now={NOW}
    onNew={none} onSwitch={none} onDelete={none} onRename={none} onPin={none} onArchive={none} onPrefs={none} onLayout={none} />);
const at = (h: string, s: string): number => h.indexOf(s);

describe("the sessions sidebar", () => {
  it("has search, the filter, group and sort menus, and a resize handle at the saved width", () => {
    const h = bar([sess()], { width: 300 });
    expect(h).toContain('placeholder="Search sessions"');
    expect(h).toContain('aria-label="Filter: All sessions"'); expect(h).toContain('aria-label="Group: No grouping"'); expect(h).toContain('aria-label="Sort: Last activity"');
    expect(h).toContain('style="width:300px"');
    expect(h).toContain('role="separator"'); expect(h).toContain('aria-valuenow="300"'); expect(h).toContain('aria-valuemin="200"'); expect(h).toContain('aria-valuemax="520"');
    expect(h).toContain("Hide the sessions sidebar");
    expect(h).not.toContain("tool-dot");                                                           // nothing is changed from the defaults
  });
  it("a filter, grouping or order other than the default is marked on its button", () => {
    expect(bar([sess()], { filter: "pinned" })).toContain('aria-label="Filter: Pinned"');
    for (const prefs of [{ filter: "running" }, { group: "date" }, { sort: "name" }, { desc: false }] as Partial<SidebarPrefs>[]) expect(bar([sess()], prefs), JSON.stringify(prefs)).toContain("tool-dot");
    expect(bar([sess()], { group: "model" })).toContain('aria-label="Group: Model"');
    expect(bar([sess()], { sort: "turns" })).toContain('aria-label="Sort: Messages"');
  });
  it("pinned sessions are a group of their own, first, with the pin shown", () => {
    const h = bar([sess({ title: "Plain one" }), sess({ title: "Pinned one", pinned: true })]);
    expect(h).toContain('aria-label="Pinned"'); expect(h).toContain('aria-label="Sessions"');
    expect(at(h, "Pinned one")).toBeGreaterThan(0); expect(at(h, "Pinned one")).toBeLessThan(at(h, "Plain one"));
    expect(h).toContain("side-pin");
  });
  it("grouping by date puts a header with a count over each day", () => {
    const h = bar([sess({ title: "Now" }), sess({ title: "Long ago", updatedAt: NOW - 90 * 86_400_000 })], { group: "date" });
    expect(h).toContain("Today"); expect(h).toContain("Older"); expect(at(h, "Today")).toBeLessThan(at(h, "Older"));
    expect(h).toMatch(/side-group-count">1</);
  });
  it("a folded group hides its sessions and says it is folded", () => {
    const rows = [sess({ title: "Hidden away", pinned: true }), sess({ title: "Still here" })];
    const h = bar(rows, { collapsed: ["pinned"] });
    expect(h).toContain('aria-expanded="false"'); expect(h).not.toContain("Hidden away"); expect(h).toContain("Still here");
    expect(bar(rows, { collapsed: [] })).toContain("Hidden away");
  });
  it("while a request runs, the other sessions cannot be opened, and the list says why", () => {
    const rows = [sess({ title: "Open one" }), sess({ title: "Other" })];
    const h = bar(rows, {}, { busy: true });
    expect(h.match(/aria-disabled="true"/g)).toHaveLength(1);                                      // only the other one
    expect(h).toContain("Stop the running request to open another session");
    expect(bar(rows)).not.toContain('aria-disabled="true"');
  });
  it("the count under the list is the total, or how many of the total a filter shows", () => {
    const rows = [sess(), sess({ pinned: true }), sess({ pinned: true }), sess({ archived: true })];
    expect(bar(rows)).toContain(">3 sessions<");
    expect(bar(rows, { filter: "pinned" })).toContain(">2 of 3<");
    expect(bar([sess()])).toContain(">1 session<");
    expect(bar([])).not.toContain("side-count");
  });
  it("the Archived filter shows archived sessions, and the default list does not", () => {
    const rows = [sess({ title: "Kept" }), sess({ title: "Put away", archived: true })];
    expect(bar(rows)).not.toContain("Put away");
    const h = bar(rows, { filter: "archived" }, {}, "");
    expect(h).toContain("Put away"); expect(h).not.toContain("Kept");
  });
  it("empty states: no sessions at all, and a filter that matches nothing", () => {
    expect(bar([])).toContain("No sessions yet.");
    const h = bar([sess()], { filter: "pinned" });
    expect(h).toContain("No pinned sessions."); expect(h).toContain("Show all sessions");
    expect(bar([sess()], { filter: "running" })).toContain("Nothing is running.");
  });
  it("a running session shows a spinner instead of its age; others show how long ago", () => {
    const h = bar([sess({ title: "Busy", running: true }), sess({ title: "Idle" })]);
    expect(h).toContain("spinner"); expect(h).toContain("5 minutes ago");
  });
  it("each row carries its actions with names a screen reader can say", () => {
    const h = bar([sess({ title: "Fix it", pinned: true })]);
    for (const label of ["Unpin Fix it", "Rename Fix it", "More actions for Fix it"]) expect(h).toContain(`aria-label="${label}"`);
    expect(bar([sess({ title: "Plain" })])).toContain('aria-label="Pin Plain"');
  });
  it("the show button and an editable title", () => {
    expect(html(<ShowSidebar onShow={none} />)).toContain("Show the sessions sidebar");
    expect(html(<EditableTitle title="Tour" className="t" onRename={none} />)).toContain("Double-click to rename");
    expect(html(<EditableTitle title="Tour" className="t" />)).not.toContain("Double-click");
  });
});

describe("search results", () => {
  const actions: ListActions = { open: none, remove: none, rename: none, pin: none, archive: none };
  const list = (rows: SessionSummary[], query: string, extra: Partial<Parameters<typeof SessionList>[0]> = {}): string => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const organized = organizeSessions(rows, { query, filter: "all", sort: "updated", desc: true, group: "none" }, NOW);
    return html(<SessionList organized={organized} terms={terms} query={query} filter="all" hasAny activeId="" busy={false} now={NOW} collapsed={[]} actions={actions}
      onToggleGroup={none} onClearSearch={none} onShowAll={none} {...extra} />);
  };
  it("the matched words are highlighted, and a match in the first message is shown under the title", () => {
    const rows = [sess({ title: "Redirect bug", preview: "why does url_for add a slash" }), sess({ title: "Other", preview: "explain blueprints and routes" }), sess({ title: "Unrelated", preview: "nothing" })];
    const h = list(rows, "redirect");
    expect(h).toContain("<mark>Redirect</mark> bug"); expect(h).not.toContain("Other"); expect(h).not.toContain("Unrelated");
    const g = list(rows, "blueprints");
    expect(g).toContain("<mark>blueprints</mark>"); expect(g).toContain("side-line2"); expect(g).toContain("Other");
  });
  it("a search with no match says so and offers to clear it", () => {
    const h = list([sess({ title: "A" })], "zzz");
    expect(h).toContain("No session matches “zzz”."); expect(h).toContain("Clear search");
  });
  it("a search opens a folded group, so a match is never hidden", () => {
    const rows = [sess({ title: "Folded match", pinned: true })];
    expect(list(rows, "", { collapsed: ["pinned"] })).not.toContain("Folded match");
    expect(list(rows, "folded", { collapsed: ["pinned"] })).toContain("<mark>Folded</mark> match");
  });
  it("Marked leaves text without matches exactly as it is", () => {
    expect(html(<Marked text="Nothing here" terms={["zzz"]} />)).toBe("Nothing here");
    expect(html(<Marked text="a <b> & c" terms={[]} />)).toBe("a &lt;b&gt; &amp; c");
    expect(html(<Marked text="Fix the fixture" terms={["fix"]} />)).toBe("<mark>Fix</mark> the <mark>fix</mark>ture");
  });
});
