import { diffArrays } from "diff";                 // jsdiff; pinned exact, its own types
import { splitLines } from "./lines.js";

export interface Hunk { id: string; oldStart: number; oldLines: string[]; newLines: string[] } // oldStart: 0-based line in `before`

/** One hunk per contiguous change block. Context lines are drawn by the UI, so the data stays minimal. */
export function toHunks(before: string, after: string): Hunk[] {
  const out: Omit<Hunk, "id">[] = [];
  let line = 0;
  let cur: Omit<Hunk, "id"> | null = null;
  for (const part of diffArrays(splitLines(before), splitLines(after))) {
    if (!part.added && !part.removed) { if (cur) out.push(cur); cur = null; line += part.value.length; continue; }
    cur ??= { oldStart: line, oldLines: [], newLines: [] };
    if (part.removed) { cur.oldLines.push(...part.value); line += part.value.length; }
    else cur.newLines.push(...part.value);
  }
  if (cur) out.push(cur);
  return out.map((h, n) => ({ ...h, id: `h${n + 1}` }));
}

/** `take` = ids of hunks to apply. take = all → after; take = none → before. Never mutates its inputs. */
export function applyHunks(before: string, hunks: readonly Hunk[], take: ReadonlySet<string>): string {
  const a = splitLines(before);
  const out: string[] = [];
  let i = 0;
  for (const h of [...hunks].sort((x, y) => x.oldStart - y.oldStart)) {
    out.push(...a.slice(i, h.oldStart), ...(take.has(h.id) ? h.newLines : h.oldLines));
    i = h.oldStart + h.oldLines.length;
  }
  out.push(...a.slice(i));
  return out.join("");
}

/** 0-based line in the preview text (before + included hunks) where each hunk starts. */
export function previewLines(hunks: readonly Hunk[], include: ReadonlySet<string>): Map<string, number> {
  const at = new Map<string, number>();
  let delta = 0;
  for (const h of [...hunks].sort((a, b) => a.oldStart - b.oldStart)) {
    at.set(h.id, h.oldStart + delta);
    if (include.has(h.id)) delta += h.newLines.length - h.oldLines.length;
  }
  return at;
}
