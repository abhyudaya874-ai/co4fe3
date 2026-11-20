import type { CommandResult } from "../host.js";

const DID_NOT_FINISH = "The command did not finish; do NOT assume it succeeded.";

/** What `run_command` tells the model: a status line, then the output. The chat's command card reads the same text back. */
export function formatCommandResult(r: Pick<CommandResult, "exitCode" | "ms" | "timedOut" | "killed">, output: string): string {
  const head = `exit ${r.exitCode ?? "none"} · ${(r.ms / 1000).toFixed(1)} s${r.timedOut ? ` · timed out (${r.timedOut})` : ""}${r.killed ? " · killed" : ""}`;
  return `${head}\n${output}${r.timedOut ? `\n${DID_NOT_FINISH}` : ""}`;
}

export interface ParsedCommand { exit: number | null; seconds: number | null; timedOut: string | null; killed: boolean; output: string }

/** The inverse of `formatCommandResult`. Text in any other shape (a refusal, an error) is returned whole as the output. */
export function parseCommandResult(text: string): ParsedCommand {
  const nl = text.indexOf("\n");
  const head = nl < 0 ? text : text.slice(0, nl);
  const m = /^exit (-?\d+|none) · (\d+(?:\.\d+)?) s(?: · timed out \(([a-z_]+)\))?( · killed)?$/.exec(head);
  if (!m) return { exit: null, seconds: null, timedOut: null, killed: false, output: text };
  let output = nl < 0 ? "" : text.slice(nl + 1);
  if (m[3] && output.endsWith(`\n${DID_NOT_FINISH}`)) output = output.slice(0, -(DID_NOT_FINISH.length + 1));
  return { exit: m[1] === "none" ? null : Number(m[1]), seconds: Number(m[2]), timedOut: m[3] ?? null, killed: !!m[4], output };
}
