#!/usr/bin/env node
// npm run verify        full gate: invariants, typecheck, unit, perf, integration (real TrueForge + fake model), build, e2e.
//                       Writes .devin/.last-verify on success (the commit hook reads it).
// npm run verify:fast   inner loop: invariants, hook self-test, typecheck, unit. Does NOT write the stamp, so it can never unlock a commit.
// npm run verify:live   full + live latency bench + a live smoke turn (needs provider keys in the environment).
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const fast = process.argv.includes("--fast");
const live = process.argv.includes("--live");

/** @type {[string, string][]} */
const stages = [
  ["invariants", "node scripts/check-invariants.mjs"],
  ["hooks", "bash scripts/hooks/test-hooks.sh"],
  ["typecheck", "npm run typecheck"],
  ["unit", "npx vitest run --project unit"],
];
if (!fast) {
  stages.push(
    ["perf", "npx vitest run --project perf"],
    ["integration", "npx vitest run --project integration"],
    ["build", "npm run build"],
    ["e2e", "npx vscode-test"],
  );
}
if (live) stages.push(["bench", "node scripts/bench-latency.mjs"], ["smoke", "node scripts/smoke-live.mjs"]);

for (const [name, cmd] of stages) {
  const t = Date.now();
  const r = spawnSync(cmd, { shell: true, stdio: "inherit" });
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  console.log(`[verify] ${name} ${r.status === 0 ? "ok" : "FAILED"} (${secs} s)`);
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!fast) {
  mkdirSync(".devin", { recursive: true });
  writeFileSync(".devin/.last-verify", new Date().toISOString() + "\n");
}
console.log(`\nverify${fast ? " (fast)" : live ? " (live)" : ""}: all stages passed`);
