import type { Problem } from "../host.js";
export type { Problem };

/** Position-independent identity: lines move when text is inserted, the complaint does not. */
export const problemKey = (p: Problem): string => `${p.code}::${p.message.replace(/\s+/g, " ").trim()}`;

/** Errors in `after` not present in `baseline`, counting duplicates (3 copies where there was 1 means 2 are new). Warnings are ignored. */
export function newErrors(baseline: readonly Problem[], after: readonly Problem[]): Problem[] {
  const before = new Map<string, number>();
  for (const p of baseline) if (p.severity === "error") before.set(problemKey(p), (before.get(problemKey(p)) ?? 0) + 1);
  const out: Problem[] = [];
  for (const p of after) {
    if (p.severity !== "error") continue;
    const k = problemKey(p), left = before.get(k) ?? 0;
    if (left > 0) before.set(k, left - 1); else out.push(p);
  }
  return out;
}

/** For prompts: errors first, then by line; at most `max` (V3Code: 12). */
export function pickProblems(all: readonly Problem[], max = 12): Problem[] {
  const rank = { error: 0, warning: 1, info: 2, hint: 3 } as const;
  return all.filter((p) => p.severity === "error" || p.severity === "warning").sort((a, b) => rank[a.severity] - rank[b.severity] || a.line - b.line).slice(0, max);
}

export const renderProblem = (p: Problem): string => `line ${p.line + 1} [${p.severity}] ${p.message.replace(/\s+/g, " ").trim()}`;
