import type { TfEvent } from "../forge/turn.js";

export const CREW = { perRequest: 3, hardStop: 8 } as const;   // V3Code: 3 running per parent, 8 in total

export interface WatchState { members: number }
export const emptyWatch = (): WatchState => ({ members: 0 });
const next = (s: WatchState, e: TfEvent): WatchState => (e.type === "thread.created" ? { members: s.members + 1 } : s);

/** Pure watchdog folded over the turn's events. A non-null `stop` makes the controller abort the turn with that sentence. */
export function crewWatch(s: WatchState, e: TfEvent): { s: WatchState; stop: string | null } {
  if (e.type === "thread.created" && s.members + 1 > CREW.hardStop) return { s, stop: `The lead started more than ${CREW.hardStop} crew members in one request.` };
  return { s: next(s, e), stop: null };
}

const DENY: [RegExp, string][] = [
  [/\bsudo\b/, "sudo"], [/\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME)/, "recursive delete outside the repo"],
  [/\bgit\s+(push|reset\s+--hard|clean\s+-[a-z]*f)/, "history-destroying git"], [/\b(curl|wget)\b[^|]*\|\s*(sh|bash)/, "pipe to shell"],
  [/\b(mkfs|dd\s+if=|shutdown|reboot)\b/, "system command"], [/(^|\s)(env|printenv)(\s|$)/, "prints secrets"],
];
export function commandPolicy(cmd: string): { ok: true } | { ok: false; why: string } {
  for (const [re, why] of DENY) if (re.test(cmd)) return { ok: false, why };
  return { ok: true };
}
