import * as vscode from "vscode";
import type { CommandRequest, CommandResult, SearchHit, SearchQuery } from "@co4fe3/agent-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";

/** VS Code ships a ripgrep; use it (skill: ripgrep). Falls back to PATH. */
export function rgPath(): string {
  const exe = process.platform === "win32" ? "rg.exe" : "rg";
  for (const dir of ["node_modules/@vscode/ripgrep/bin", "node_modules.asar.unpacked/@vscode/ripgrep/bin"]) {
    const p = path.join(vscode.env.appRoot, dir, exe);
    if (existsSync(p)) return p;
  }
  return exe;                                                        // PATH; editorHost.search falls back to scanning the index
}

/** ripgrep. Literal by default; `regex: true` opts in. Never throws on "no matches": returns []. */
export async function rgSearch(root: string, q: SearchQuery, signal: AbortSignal): Promise<SearchHit[]> {
  const args = [
    "--json", "--max-count", "5", "--max-filesize", "1M", "--max-columns", "300",
    ...(q.regex ? [] : ["-F"]), ...(q.glob ? ["-g", q.glob] : []),
    "--", q.pattern, ".",
  ];
  const r = await runCapped(`${JSON.stringify(rgPath())} ${args.map((a) => JSON.stringify(a)).join(" ")}`.replace(/""/g, '"'), root, 30_000, 4_000_000, signal);
  const hits: SearchHit[] = [];
  for (const line of r.output.split("\n")) {
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line) as { type: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
      if (m.type === "match" && m.data?.path?.text && m.data.line_number && m.data.lines?.text !== undefined)
        hits.push({ path: toRel(root, m.data.path.text), line: m.data.line_number, text: m.data.lines.text.trimEnd() });
    } catch { /* rg --json emits one JSON object per line; blanks and summaries are skipped */ }
    if (hits.length >= (q.maxHits ?? 200)) break;
  }
  return hits;
}

const toRel = (root: string, abs: string): string => {
  const r = path.relative(root, abs).split(path.sep).join("/");
  return r.startsWith("..") ? abs : r;
};

/** Runs one shell command in `cwd`. Killed when `signal` aborts or on a wall-clock timeout. Output capped (first 2 KB + last tail). */
export function runCapped(cmd: string, cwd: string, timeoutMs: number, maxBytes: number, signal: AbortSignal): Promise<CommandResult> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/(_API_KEY|_TOKEN|_SECRET)$/i.test(k)));
    const child = spawn(cmd, { cwd, shell: true, env, detached: process.platform !== "win32" });
    let out = "", truncated = false, timedOut: CommandResult["timedOut"] = null, killed = false;
    const add = (b: Buffer) => {
      out += b.toString("utf8");
      if (out.length > maxBytes) { out = out.slice(0, 2048) + `\n…(middle ${out.length - maxBytes + 100} characters omitted)…\n` + out.slice(-(maxBytes - 2100)); truncated = true; }
    };
    child.stdout?.on("data", add); child.stderr?.on("data", add);
    const kill = () => {
      killed = true;
      try { if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]); else process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ }
    };
    const timer = setTimeout(() => { timedOut = "wall_clock"; kill(); }, timeoutMs);
    signal.addEventListener("abort", () => { timedOut ??= "wall_clock"; kill(); }, { once: true });
    child.on("close", (code) => {
      clearTimeout(timer); signal.removeEventListener("abort", kill);
      resolve({ exitCode: code, output: out, truncated, timedOut, killed, ms: Math.round(performance.now() - t0) });
    });
    child.on("error", () => { clearTimeout(timer); resolve({ exitCode: null, output: out, truncated, timedOut, killed, ms: Math.round(performance.now() - t0) }); });
  });
}

export type { CommandRequest };
