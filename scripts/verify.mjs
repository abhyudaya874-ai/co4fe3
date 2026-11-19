#!/usr/bin/env node
// npm run verify        full gate: invariants, hooks, typecheck, unit, perf, integration (real TrueForge + fake model), build, e2e.
//                       Writes .devin/.last-verify on success (the commit hook reads it).
// npm run verify:fast   inner loop: invariants, hook self-test, typecheck, unit. Does NOT write the stamp, so it can never unlock a commit.
// npm run verify:live   full + live latency bench + a live smoke turn (needs provider keys in the environment).
//
// Pending stages: perf, integration and e2e need files that later workflows create (09, 01, 04). A stage with no
// inputs prints "pending" and does not fail, until that workflow's docs/progress/NN-*.md has a line starting
// "EXIT: passed" (written after its exit check). From then on, missing inputs FAIL the gate, so a stage can never
// go back to pending. Once its inputs exist, a stage always runs. Workflow 12 needs zero pending.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
const fast = process.argv.includes("--fast");
const live = process.argv.includes("--live");
const filesIn = (dir, suffix) => existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(suffix));
const workflowDone = (nn) => existsSync("docs/progress") && readdirSync("docs/progress")
  .some((f) => f.startsWith(`${nn}-`) && /^EXIT: passed/m.test(readFileSync(`docs/progress/${f}`, "utf8")));
/** @type {{ name: string, cmd: string, owner?: string, ready?: () => boolean }[]} */
const stages = [
  { name: "invariants", cmd: "node scripts/check-invariants.mjs" },
  { name: "hooks", cmd: "bash scripts/hooks/test-hooks.sh" },
  { name: "typecheck", cmd: "npm run typecheck" },
  { name: "unit", cmd: "npx vitest run --project unit" },
];
if (!fast) {
  stages.push(
    { name: "perf", cmd: "npx vitest run --project perf", owner: "09", ready: () => filesIn("packages/agent-core/test/perf", ".perf.test.ts") },
    { name: "integration", cmd: "npx vitest run --project integration", owner: "01", ready: () => existsSync("test/integration/global-setup.ts") && filesIn("test/integration", ".test.ts") },
    { name: "build", cmd: "npm run build" },
    { name: "e2e", cmd: "npx vscode-test", owner: "04", ready: () => existsSync(".vscode-test.mjs") && filesIn("extensions/co4fe3-vscode/test", ".test.ts") },
  );
}
if (live) stages.push({ name: "bench", cmd: "node scripts/bench-latency.mjs" }, { name: "smoke", cmd: "node scripts/smoke-live.mjs" });
const pending = [];
for (const { name, cmd, owner, ready } of stages) {
  if (owner && ready && !ready()) {
    if (workflowDone(owner)) {
      console.log(`[verify] ${name} FAILED: workflow ${owner} passed its exit check (docs/progress/${owner}-*.md says "EXIT: passed"), but this stage has no inputs. Restore the tests rule 80 lists for workflow ${owner}.`);
      process.exit(1);
    }
    console.log(`[verify] ${name} pending (its inputs arrive in workflow ${owner})`);
    pending.push(name);
    continue;
  }
  const t = Date.now();
  const r = spawnSync(cmd, { shell: true, stdio: "inherit" });
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  console.log(`[verify] ${name} ${r.status === 0 ? "ok" : "FAILED"} (${secs} s)`);
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!fast) {
  mkdirSync(".devin", { recursive: true });
  writeFileSync(".devin/.last-verify", `${new Date().toISOString()}${pending.length ? ` pending=${pending.join(",")}` : ""}\n`);
}
if (pending.length) console.log(`[verify] pending: ${pending.join(", ")}`);
console.log(`\nverify${fast ? " (fast)" : live ? " (live)" : ""}: all stages passed`);
