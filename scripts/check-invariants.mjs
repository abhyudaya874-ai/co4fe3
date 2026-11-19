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

function scan(files, re, message, except = [], { comments = false } = {}) {
  for (const f of files) {
    const r = rel(f);
    if (except.includes(r)) continue;
    checks++;
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (!comments && /^\s*(\/\/|\/?\*)/.test(line)) return; // code checks: comments may name forbidden things
      if (re.test(line)) problems.push(`${r}:${i + 1} — ${message}`);
    });
  }
}

// The source of truth is runtime/modes.ts TOOLS (rule 50 §1); before it exists, this list.
// Order matters: registration order is read-first (rule 60 lever 2).
const KNOWN_TOOLS = ["repo_map", "search_workspace", "find_symbol", "pack_context", "read_file", "list_changes",
  "board_read", "board_write", "load_instructions", "propose_edit", "run_command"];
const GATED_TOOLS = ["propose_edit", "run_command"];

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
    for (const t of GATED_TOOLS) if (!(editor?.requireApprovalForTools ?? []).includes(t)) problems.push(`${file} — ${t} must be in requireApprovalForTools (law 4)`);
    if (editor && editor.preload !== true) problems.push(`${file} — the editor server must be preload: true (rule 60, lever 2)`);
    // The lead's text must use the brief lines parseProfile reads (rule 50 §1), and name the context tool it should prefer.
    for (const needle of ["PROFILE: research", "PROFILE: work", "pack_context", "At most 3 members"]) if (!(spec.instructions ?? "").includes(needle)) problems.push(`${file} — the lead instructions must contain "${needle}" (rule 50 §7)`);
  } else if ((spec.mcpServers ?? []).length) problems.push(`${file} — the inline agent has no tools (rule 60, lever 1)`);
  if (spec.config?.askUserQuestions?.enabled !== false) problems.push(`${file} — askUserQuestions must be disabled (rule 20, trap 14)`);
  if (spec.config?.contextManagement?.largeToolResponse?.enabled !== false) problems.push(`${file} — largeToolResponse must be disabled: it needs a sandbox (rule 20, trap 12)`);
}

// One tool list, everywhere (KNOWN_TOOLS / GATED_TOOLS are declared at the top of this file).
const modesFile = "packages/agent-core/src/runtime/modes.ts";
let tools = KNOWN_TOOLS;
if (existsSync(modesFile)) {
  checks++;
  const m = /export const TOOLS\s*=\s*\[([\s\S]*?)\]/.exec(readFileSync(modesFile, "utf8"));
  const found = m ? [...m[1].matchAll(/["']([a-z_]+)["']/g)].map((x) => x[1]) : [];
  if (!found.length) problems.push(`${modesFile} — could not find \`export const TOOLS = [...]\` (rule 50 §1)`);
  else if (found.join() !== KNOWN_TOOLS.join()) problems.push(`${modesFile} — TOOLS is [${found.join(", ")}] but the documented list is [${KNOWN_TOOLS.join(", ")}]. Change both (CODEMAP, rule 50, this script) in one commit, with the human's okay.`);
  else tools = found;
}
const server = "packages/agent-core/src/mcp/server.ts";
if (existsSync(server)) {
  checks++;
  const registered = [...readFileSync(server, "utf8").matchAll(/registerTool\(\s*["']([a-z_]+)["']/g)].map((x) => x[1]);
  for (const t of registered) if (!tools.includes(t)) problems.push(`${server} — tool ${t} is not in TOOLS / CODEMAP`);
  for (const t of tools) if (!registered.includes(t)) problems.push(`${server} — TOOLS lists ${t} but it is not registered`);
  if (registered.length === tools.length && registered.join() !== tools.join()) problems.push(`${server} — tools must be registered in TOOLS order (read-first, rule 60): ${tools.join(", ")}`);
}
// The docs must list the same tools (doc drift is how small models invent names).
if (existsSync("docs/CODEMAP.md")) {
  checks++;
  const sec = /## The (\d+) MCP tools[^\n]*\n([\s\S]*?)(\n## |$)/.exec(readFileSync("docs/CODEMAP.md", "utf8"));
  if (!sec) problems.push("docs/CODEMAP.md — missing the '## The N MCP tools' section");
  else {
    if (Number(sec[1]) !== tools.length) problems.push(`docs/CODEMAP.md — says ${sec[1]} MCP tools, the list has ${tools.length}`);
    for (const t of tools) if (!new RegExp(`\`${t}\\{`).test(sec[2])) problems.push(`docs/CODEMAP.md — tool ${t} is missing from the MCP tools section`);
  }
}

// Rule 05: no copied V3Code / Void code, and no borrowed product identifiers in our exports.
// Headers live in comments, so this scan includes comment lines. This file names the pattern, so it is excluded.
scan([...product, ...walk("scripts", [".mjs"]), ...walk("test", TS)], /Copyright.{0,40}(KandD Labs|Glass Devtools)|Part of V3Code, distributed by/, "V3Code/Void licence header: this looks like copied code (rule 05). Reimplement the idea in our own code", ["scripts/check-invariants.mjs"], { comments: true });
scan(product, /export\s+(?:async\s+)?(?:function|class|const|interface|type)\s+(?:void|Void|v3code|V3Code|V3)[A-Z_]/, "exported name borrowed from V3Code/Void (rule 05): use a co4fe3 name");

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
