// Bundles the extension (CJS, vscode external) and, when they exist, its e2e tests.
import { build, context } from "esbuild";
import { existsSync, readdirSync } from "node:fs";
const base = { bundle: true, platform: "node", format: "cjs", target: "node20", sourcemap: true, external: ["vscode"], logLevel: "info" };
const ext = { ...base, entryPoints: ["src/extension.ts"], outfile: "out/extension.cjs" };
const tests = existsSync("test") ? readdirSync("test").filter((f) => f.endsWith(".test.ts")).map((f) => `test/${f}`) : [];
if (process.argv.includes("--watch")) await (await context(ext)).watch();
else {
  await build(ext);
  if (tests.length) await build({ ...base, entryPoints: tests, outdir: "out/test", external: ["vscode", "mocha"] });
}
