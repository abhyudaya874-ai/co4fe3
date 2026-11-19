#!/usr/bin/env node
// Mechanical architecture checks for co4fe3 (AGENTS.md laws 1-4, 7 and rule 10). Every message says what to do instead.
// Missing folders are skipped, so this runs from the first bootstrap commit onwards.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const problems = [];
let checks = 0;
const rel = (p) => relative(root, p).split(sep).join("/");

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (["node_modules", "out", "media", "dist"].includes(name) || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

function scan(files, re, message, except = []) {
  for (const f of files) {
    const r = rel(f);
    if (except.includes(r)) continue;
    checks++;
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return; // comments may name forbidden things
      if (re.test(line)) problems.push(`${r}:${i + 1} — ${message}`);
    });
  }
}

const TS = [".ts", ".tsx"];
const core = walk("packages/agent-core/src", TS);
const ext = walk("extensions/co4fe3-vscode/src", TS);
const web = walk("extensions/co4fe3-vscode/webview/src", TS);
const product = [...core, ...ext, ...web];

// Law 2 + 3: agent-core is editor-free, process-free and write-free.
scan(core, /from\s+["']vscode["']|require\(["']vscode["']\)/, "agent-core imports vscode (law 2): pass it in through EditorHost / Applier");
scan(core, /child_process/, "agent-core spawns a process: use EditorHost.run");
scan(core, /\b(writeFile|writeFileSync|appendFile|appendFileSync|unlink|unlinkSync|rmSync|createWriteStream)\b/, "agent-core writes a file (law 3): use Applier.apply");

// Law 3: one write path, one process path.
scan(ext, /workspace\.applyEdit|workspace\.fs\.(writeFile|delete|rename)|\.save\(\)/, "workspace write outside review/apply.ts (law 3): call Applier.apply / applyDecision", ["extensions/co4fe3-vscode/src/review/apply.ts"]);
scan(ext, /child_process/, "child_process outside host/commands.ts: use runCapped()", ["extensions/co4fe3-vscode/src/host/commands.ts"]);

// Law 1: the extension never calls a model provider.
scan(product, /integrate\.api\.nvidia\.com|generativelanguage\.googleapis\.com|openrouter\.ai\/api|api\.openai\.com|api\.anthropic\.com/, "provider host in product code (law 1): models are configured in TrueForge");
scan(product, /from\s+["'](openai|@google\/genai|@google\/generative-ai|@anthropic-ai\/sdk)["']/, "provider SDK import (law 1)");

// Model text is data; the webview reaches agent-core only through /panel.
scan(web, /dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\(/, "model text rendered as HTML: use the md.tsx renderer");
scan(web, /from\s+["']@co4fe3\/agent-core(?!\/panel)["'/]/, "webview imports agent-core outside @co4fe3/agent-core/panel");

// The agent definitions the judges read must match the rules.
for (const [file, isCoder] of [["agents/co4fe3-coder.agent.json", true], ["agents/co4fe3-inline.agent.json", false]]) {
  if (!existsSync(file)) continue;
  checks++;
  let spec;
  try { spec = JSON.parse(readFileSync(file, "utf8")); } catch (e) { problems.push(`${file} — invalid JSON: ${e.message}`); continue; }
  const text = JSON.stringify(spec);
  const stray = [...new Set([...text.matchAll(/\$[A-Z_]+/g)].map((m) => m[0]))].filter((t) => t !== "$MODEL" && t !== "$EDITOR");
  if (stray.length) problems.push(`${file} — unknown placeholders ${stray.join(", ")}; buildSpec fills only $MODEL and $EDITOR`);
  if (/"(mcp_servers|require_approval_for_tools|dynamic_sub_agents|ask_user_questions|context_management)"/.test(text)) problems.push(`${file} — snake_case keys: the TS SDK wants camelCase (mcpServers, requireApprovalForTools, …)`);
  const editor = (spec.mcpServers ?? []).find((m) => m.name === "$EDITOR");
  if (isCoder) {
    for (const t of ["propose_edit", "run_command"]) if (!(editor?.requireApprovalForTools ?? []).includes(t)) problems.push(`${file} — ${t} must be in requireApprovalForTools (law 4)`);
    if (editor && editor.preload !== true) problems.push(`${file} — the editor server must be preload: true (rule 60, lever 2)`);
  } else if ((spec.mcpServers ?? []).length) problems.push(`${file} — the inline agent has no tools (rule 60, lever 1)`);
  if (spec.config?.askUserQuestions?.enabled !== false) problems.push(`${file} — askUserQuestions must be disabled (rule 20, trap 14)`);
  if (spec.config?.contextManagement?.largeToolResponse?.enabled !== false) problems.push(`${file} — largeToolResponse must be disabled: it needs a sandbox (rule 20, trap 12)`);
}

// The MCP server registers exactly the documented tools.
const server = "packages/agent-core/src/mcp/server.ts";
if (existsSync(server)) {
  checks++;
  const known = ["read_file", "search_workspace", "find_symbol", "repo_map", "propose_edit", "run_command", "board_read", "board_write", "list_changes", "load_instructions"];
  for (const m of readFileSync(server, "utf8").matchAll(/registerTool\(\s*["']([a-z_]+)["']/g))
    if (!known.includes(m[1])) problems.push(`${server} — tool ${m[1]} is not in CODEMAP: add it there, to rule 50's role sets and to this list (with the human's okay)`);
}

// Law 7: no secrets in tracked files.
try {
  const KEY = /nvapi-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|sk-or-v1-[0-9a-f]{20,}|sk-(proj-)?[A-Za-z0-9]{32,}/;
  const tracked = execSync("git ls-files", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean);
  for (const f of tracked) {
    if (f === ".env" || f === "config/providers.json") problems.push(`${f} — must not be tracked: git rm --cached ${f}`);
    if (!existsSync(f) || /\.(png|jpe?g|gif|ico|vsix|pdf|mp4)$/i.test(f) || statSync(f).size > 2_000_000) continue;
    checks++;
    readFileSync(f, "utf8").split("\n").forEach((line, i) => { if (KEY.test(line)) problems.push(`${f}:${i + 1} — looks like a real API key (law 7): remove it AND rotate it at the provider`); });
  }
} catch { /* not a git repo yet: skip */ }

if (problems.length) {
  console.error(`invariants: ${problems.length} problem(s)\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`invariants: ok (${checks} checks)`);
