import type { SessionFilter, SessionGroup, SessionSort, SessionSummary } from "@co4fe3/agent-core/panel";

// What the sessions sidebar shows: search, filter, group and sort over the list the host sends. Pure, so the rules are tested.

export interface SessionQuery { query: string; filter: SessionFilter; sort: SessionSort; desc: boolean; group: SessionGroup }
export interface SessionGroupView { id: string; title: string; items: SessionSummary[] }
export interface Organized {
  groups: SessionGroupView[];
  shown: number;                       // sessions on screen
  total: number;                       // sessions the filter could show without the search (archived ones count only in the Archived filter)
}

export const shortModel = (fqn: string): string => fqn.split("/").at(-1) ?? fqn;

/** Search words: lower-cased, split on spaces. Every word must be found (in the title, the model or the first message). */
export const searchTerms = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);

const haystack = (s: SessionSummary): string => `${s.title}\n${shortModel(s.model)}\n${s.model}\n${s.preview}`.toLowerCase();
export const matchesTerms = (s: SessionSummary, terms: readonly string[]): boolean => { const h = haystack(s); return terms.every((t) => h.includes(t)); };

/** Where the search words occur in `text`, as merged [start, end) ranges, for highlighting. */
export function matchRanges(text: string, terms: readonly string[]): [number, number][] {
  const lower = text.toLowerCase(), found: [number, number][] = [];
  for (const t of terms) for (let at = lower.indexOf(t); t && at >= 0; at = lower.indexOf(t, at + t.length)) found.push([at, at + t.length]);
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const r of found) { const last = out.at(-1); if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else out.push([r[0], r[1]]); }
  return out;
}

const DAY = 86_400_000;
/** The calendar-day bucket of a time, in the local time zone. */
export function dateBucket(ts: number, now: number): { id: string; title: string } {
  const d = new Date(now);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (ts >= today) return { id: "date:today", title: "Today" };
  if (ts >= today - DAY) return { id: "date:yesterday", title: "Yesterday" };
  if (ts >= today - 6 * DAY) return { id: "date:week", title: "Previous 7 days" };
  if (ts >= today - 29 * DAY) return { id: "date:month", title: "Previous 30 days" };
  return { id: "date:older", title: "Older" };
}
const DATE_ORDER = ["date:today", "date:yesterday", "date:week", "date:month", "date:older"];

export function compareSessions(a: SessionSummary, b: SessionSummary, sort: SessionSort, desc: boolean): number {
  const dir = desc ? -1 : 1;
  const by = sort === "name" ? a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" })
    : sort === "created" ? a.createdAt - b.createdAt
    : sort === "turns" ? a.turns - b.turns
    : a.updatedAt - b.updatedAt;
  return by * dir || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);          // ties: the more recent first, then a stable order
}

const status = (s: SessionSummary): { id: string; title: string } =>
  s.running ? { id: "status:running", title: "Running" } : s.edits > 0 ? { id: "status:edits", title: "Changed files" } : { id: "status:chat", title: "Questions only" };
const STATUS_ORDER = ["status:running", "status:edits", "status:chat"];

/** Search, filter, group and sort. Pinned sessions come first in their own group (unless the filter is Pinned or Archived). */
export function organizeSessions(all: readonly SessionSummary[], q: SessionQuery, now: number): Organized {
  const terms = searchTerms(q.query);
  const archivedView = q.filter === "archived";
  const base = all.filter((s) => s.archived === archivedView);
  const passes = (s: SessionSummary): boolean =>
    (q.filter === "pinned" ? s.pinned : q.filter === "running" ? s.running : q.filter === "edited" ? s.edits > 0 : true) && matchesTerms(s, terms);
  const kept = base.filter(passes);
  const sorted = (xs: SessionSummary[]): SessionSummary[] => [...xs].sort((a, b) => compareSessions(a, b, q.sort, q.desc));
  const done = (groups: SessionGroupView[]): Organized => ({ groups: groups.filter((g) => g.items.length), shown: kept.length, total: base.length });

  if (q.filter === "pinned") return done([{ id: "pinned", title: "Pinned", items: sorted(kept) }]);
  const pinned = archivedView ? [] : kept.filter((s) => s.pinned);
  const rest = archivedView ? kept : kept.filter((s) => !s.pinned);
  const head: SessionGroupView[] = [{ id: "pinned", title: "Pinned", items: sorted(pinned) }];

  if (q.group === "none") return done([...head, { id: "all", title: pinned.length ? "Sessions" : "", items: sorted(rest) }]);

  const buckets = new Map<string, SessionGroupView>();
  const put = (key: { id: string; title: string }, s: SessionSummary): void => {
    const g = buckets.get(key.id) ?? { id: key.id, title: key.title, items: [] };
    g.items.push(s); buckets.set(key.id, g);
  };
  for (const s of rest) {
    if (q.group === "date") put(dateBucket(q.sort === "created" ? s.createdAt : s.updatedAt, now), s);
    else if (q.group === "status") put(status(s), s);
    else put({ id: `model:${s.model || "none"}`, title: s.model ? shortModel(s.model) : "No model" }, s);
  }
  const order = (g: SessionGroupView): number => (q.group === "date" ? DATE_ORDER.indexOf(g.id) : STATUS_ORDER.indexOf(g.id));
  const groups = [...buckets.values()].sort(q.group === "model"
    ? (a, b) => (a.id === "model:none" ? 1 : b.id === "model:none" ? -1 : a.title.localeCompare(b.title))      // "No model" last
    : (a, b) => order(a) - order(b));
  for (const g of groups) g.items = sorted(g.items);
  if (q.group === "date" && !q.desc) groups.reverse();                                                          // oldest first when the order is reversed
  return done([...head, ...groups]);
}

/** A one-line description for a tooltip: the model, the messages, the edits. */
export function sessionDetail(s: SessionSummary): string {
  return [s.model ? shortModel(s.model) : "", `${s.turns} message${s.turns === 1 ? "" : "s"}`, s.edits ? `${s.edits} change${s.edits === 1 ? "" : "s"} applied` : ""].filter(Boolean).join(" · ");
}

/** The label of the sort button's direction toggle, in words that fit the key. */
export function directionLabels(sort: SessionSort): { desc: string; asc: string } {
  return sort === "name" ? { desc: "Z to A", asc: "A to Z" } : sort === "turns" ? { desc: "Most messages first", asc: "Fewest first" } : { desc: "Newest first", asc: "Oldest first" };
}

/** How many sessions each filter would show (archived sessions count only under Archived), for the numbers in the filter menu. */
export function filterCounts(all: readonly SessionSummary[]): Record<SessionFilter, number> {
  const live = all.filter((s) => !s.archived);
  return { all: live.length, pinned: live.filter((s) => s.pinned).length, running: live.filter((s) => s.running).length, edited: live.filter((s) => s.edits > 0).length, archived: all.length - live.length };
}

/** A short piece of `text` around the first search word, for the second line of a search result. */
export function snippet(text: string, terms: readonly string[], max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const lower = flat.toLowerCase();
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, Math.min(at - 24, flat.length - max));
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + max)}${start + max < flat.length ? "…" : ""}`;
}

/** What to show under a result's title: the first message when the words are in it, else the model when they are in that, else nothing. */
export function resultLine(s: SessionSummary, terms: readonly string[]): string {
  if (!terms.length) return "";
  const inTitle = (t: string): boolean => s.title.toLowerCase().includes(t);
  if (terms.every(inTitle)) return "";
  const preview = s.preview.toLowerCase();
  if (terms.some((t) => !inTitle(t) && preview.includes(t))) return snippet(s.preview, terms.filter((t) => !inTitle(t)));
  return s.model ? shortModel(s.model) : "";
}
