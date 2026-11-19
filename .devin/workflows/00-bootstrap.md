---
description: Create the co4fe3 repo skeleton, pin every dependency, get the full gate green, start TrueForge, and prepare the flask rehearsal clone
argument-hint: ""
---

# 00 Bootstrap

Goal: a real but nearly empty repo where `npm run verify` is green (perf, integration and e2e show as `pending`),
`npm run trueforge` serves on :8790, and `.cache/flask` is the pinned flask with a working venv. The only product
code is the skeleton in step 4.

Steps 2–5 were dry-run on Thu 19 Nov 2026, 20:50 IST (Node 26.7, npm 11.19) with exactly these files and versions.
Copy them exactly. If a version below no longer installs, stop and report it; do not pick another version yourself.

## 1. Check the machine

```bash
df -h ~ | tail -1            # need ≥ 5 GB free
node -v                      # ≥ 22.14
python3 --version            # ≥ 3.9 for flask 3.1
command -v rg jq git code    # jq is needed by the hooks; rg is optional (VS Code ships one)
git -C /home/de3p/V3Code rev-parse --short HEAD   # the reference architecture (rule 05): expect 2eac91fb. Read-only; never build it.
bash scripts/hooks/test-hooks.sh                  # the guards work before anything else is written
node scripts/check-invariants.mjs                 # the pack itself is clean (it scans every tracked file for keys)
```

If `/home/de3p/V3Code` is missing, the pack still works (`docs/study/v3code.md` holds the map). Clone it read-only
for reference: `git clone https://github.com/HeavenFYouMissed/V3Code /home/de3p/V3Code`. If its HEAD moved past
`2eac91fb`, re-read the files the study cites before relying on a line number.

## 2. Root files (copy exactly)

`package.json`:

```json
{
  "name": "co4fe3",
  "private": true,
  "license": "MIT",
  "type": "module",
  "workspaces": ["packages/*", "extensions/*"],
  "engines": { "node": ">=22.14" },
  "scripts": {
    "trueforge": "npx --yes @truefoundry/trueforge@0.185.1",
    "setup:trueforge": "node scripts/setup-trueforge.mjs",
    "bench:latency": "node scripts/bench-latency.mjs",
    "typecheck": "tsc -p packages/agent-core && tsc -p extensions/co4fe3-vscode && tsc -p extensions/co4fe3-vscode/webview && tsc -p test",
    "build": "npm run build -w co4fe3-vscode",
    "verify": "node scripts/verify.mjs",
    "verify:fast": "node scripts/verify.mjs --fast",
    "verify:live": "node scripts/verify.mjs --live"
  }
}
```

`0.185.1` is the TrueForge server version `npm view @truefoundry/trueforge version` printed on 19 Nov. Use the same
number wherever a rule says `<PINNED>` (rule 20, rule 80's integration harness), and write it into
`docs/DECISIONS.md` D2.

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "lib": ["ES2023"],
    "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": false,
    "noImplicitOverride": true, "noFallthroughCasesInSwitch": true, "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true, "noEmit": true, "isolatedModules": true, "verbatimModuleSyntax": false
  }
}
```

Nothing is emitted by tsc. esbuild bundles the extension, Vite bundles the webview, and vitest runs TS directly
(decision D9). TypeScript is 7.x: a side-effect import such as `import "./main.css"` needs a type declaration, which
`webview/src/vite-env.d.ts` provides (step 4).

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["packages/*/test/**/*.test.ts"], exclude: ["**/perf/**"], environment: "node" } },
      { test: { name: "perf", include: ["packages/*/test/perf/**/*.perf.test.ts"], environment: "node" } },
      { test: { name: "integration", include: ["test/integration/**/*.test.ts"], globalSetup: ["test/integration/global-setup.ts"], testTimeout: 60_000, hookTimeout: 90_000, fileParallelism: false } },
    ],
  },
});
```

`.gitignore` (`**/` matters: the webview bundle lands in `extensions/co4fe3-vscode/media/`, not in a root `media/`):

```
node_modules/
out/
dist/
**/media/panel.*
*.vsix
.vscode-test/
.env
config/providers.json
.cache/
bench/*.json
.devin/.last-verify
.devin/ledger.md
.devin/hook-debug.log
```

`.env.example`, with no values:

```
# copy to .env and fill in; never commit .env
NVIDIA_API_KEY=
GEMINI_API_KEY=
TRUEFORGE_BASE_URL=http://localhost:8790
```

`LICENSE`: MIT, "Copyright (c) 2026 co4fe3 contributors".

## 3. Workspaces and pinned installs

```bash
mkdir -p packages/agent-core/{src/panel,test} extensions/co4fe3-vscode/{src,test,media,webview/src} test/{fakes,fixtures,integration} docs/progress agents config
```

`packages/agent-core/package.json`:

```json
{
  "name": "@co4fe3/agent-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts", "./panel": "./src/panel/index.ts" }
}
```

The exports point at TypeScript source on purpose. esbuild, Vite and vitest all read `.ts`, so agent-core has no
build step and no stale `dist/`.

`extensions/co4fe3-vscode/package.json`: copy the whole manifest from the `vscode-extension` skill.

The four `tsconfig.json` files (one line each):

```jsonc
// packages/agent-core/tsconfig.json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test"] }
// extensions/co4fe3-vscode/tsconfig.json   (mocha: the e2e tests use suite/test, rule 80)
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node", "vscode", "mocha"] }, "include": ["src", "test"] }
// extensions/co4fe3-vscode/webview/tsconfig.json   (DOM only here; the extension host has no DOM)
{ "extends": "../../../tsconfig.base.json", "compilerOptions": { "lib": ["ES2023", "DOM", "DOM.Iterable"], "jsx": "react-jsx", "types": [] }, "include": ["src"] }
// test/tsconfig.json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["fakes", "integration"] }
```

Install every dependency the whole build needs, now, with these exact versions. Later workflows install nothing,
so they never guess a version. (`npm i` asks the human for permission; that is expected.)

```bash
npm i -w @co4fe3/agent-core --save-exact @truefoundry/trueforge-sdk@0.185.0 @modelcontextprotocol/sdk@1.32.2 zod@4.6.7 diff@9.0.0
npm i -D --save-exact typescript@7.0.2 vitest@5.1.1 fast-check@4.10.3 @fast-check/vitest@0.5.0 @types/node@22.20.5
npm i -D -w co4fe3-vscode --save-exact esbuild@0.28.2 vite@8.3.8 @vitejs/plugin-react@6.3.0 react@19.3.1 react-dom@19.3.1 @types/react@19.3.0 @types/react-dom@19.3.0 @types/vscode@1.90.0 @vscode/test-cli@0.0.15 @vscode/test-electron@3.1.0 @types/mocha@10.0.10 @vscode/vsce@4.1.1
```

Notes:

- `@types/vscode` stays at `1.90.0` to match `engines.vscode` (`^1.90.0`). vsce refuses to package when the types are newer.
- `diff@9` ships its own types; do not add `@types/diff`.
- zod 4.6.7 satisfies the MCP SDK's peer range (`^3.25 || ^4.0`); `@fast-check/vitest` accepts vitest 5.
- npm 11 may print `install-scripts … esbuild (postinstall)`. esbuild still works (its platform binary is an
  optional dependency). Do not approve scripts to silence it.
- React and the other webview libraries are devDependencies on purpose: Vite bundles them, and the `.vsix` is
  packaged with `--no-dependencies` (workflow 12).

## 4. The skeleton (real entry files that later workflows grow; each typecheck project needs at least one input)

`packages/agent-core/src/index.ts`:

```ts
// Public entry of @co4fe3/agent-core. Re-exports every module except panel/* (CODEMAP). Grows one line per module.
export {};
```

`packages/agent-core/src/panel/index.ts`:

```ts
// The only agent-core entry the webview may import (@co4fe3/agent-core/panel). Filled in by workflow 05.
export {};
```

`packages/agent-core/test/boot.test.ts`:

```ts
import { it, expect } from "vitest";
import * as core from "../src/index.js";

it("loads the agent-core entry without touching vscode or the network", () => {
  expect(typeof core).toBe("object");
});
```

`extensions/co4fe3-vscode/src/extension.ts` (rule 10's activation sequence is the end state; each workflow adds its
own lines):

```ts
import * as vscode from "vscode";

// Wiring only (rule 10). Each workflow adds its lines to activate(); nothing slow is awaited here (< 150 ms).
export function activate(ctx: vscode.ExtensionContext): void {
  const out = vscode.window.createOutputChannel("co4fe3", { log: true });
  ctx.subscriptions.push(out);
  out.info("co4fe3 activated");
}

export function deactivate(): void {}
```

`extensions/co4fe3-vscode/esbuild.mjs` and `extensions/co4fe3-vscode/webview/vite.config.ts`: copy from the
`vscode-extension` skill ("Builds").

`extensions/co4fe3-vscode/webview/src/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import "./main.css";

// Mounts the panel. Workflow 05 replaces <p> with <App /> and owns acquireVsCodeApi() here.
const root = document.getElementById("root");
if (root) createRoot(root).render(<p>co4fe3</p>);
```

`extensions/co4fe3-vscode/webview/src/main.css`:

```css
body { color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
```

`extensions/co4fe3-vscode/webview/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

`extensions/co4fe3-vscode/media/icon.svg` (the activity-bar icon the manifest names):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 6l-5 6 5 6M16 6l5 6-5 6M13.5 4l-3 16"/></svg>
```

`test/fakes/fake-openai.ts`: copy the whole file from rule 80 ("The fake model"), including its four helpers.
Workflow 01's `fake` section uses it.

## 5. Gate and hooks

The pack already ships `scripts/verify.mjs`, `scripts/check-invariants.mjs` and `scripts/hooks/*.sh`.

```bash
chmod +x scripts/hooks/*.sh
npm run verify:fast
npm run verify
```

What `npm run verify` prints at this point (dry run, 19 Nov):

```
[verify] invariants ok · hooks ok · typecheck ok · unit ok
[verify] perf pending (its inputs arrive in workflow 09)
[verify] integration pending (its inputs arrive in workflow 01)
[verify] build ok
[verify] e2e pending (its inputs arrive in workflow 04)
[verify] pending: perf, integration, e2e
verify: all stages passed
```

A stage runs as soon as its inputs exist. It is `pending` only while it has no inputs **and** its workflow's
`docs/progress/NN-*.md` has no `EXIT: passed` line. Every progress file ends with that line once its exit check
passes (the master prompt says how), and from then on the stage is required. Vite prints a warning about "ESM syntax in a file loaded as CommonJS" for `vite.config.ts`. It is harmless; leave
the manifest without `"type"`.

## 6. TrueForge

```bash
npm run trueforge            # leave running in its own terminal; first run downloads the package
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8790/api/v1/docs    # 200
```

If your shell tool cannot keep a process running, ask the human to start it in a terminal and continue when the curl
prints 200. Open http://localhost:8790 once and confirm the UI loads. Do not configure models by hand. Workflow 08's
setup script does that. For the spike, run the step 1 setup from workflow 01.

## 7. The rehearsal target (flask 3.1.3)

```bash
git clone https://github.com/pallets/flask .cache/flask
git -C .cache/flask checkout 3.1.3 && git -C .cache/flask rev-parse --short HEAD    # must print 22d92470
python3 -m venv .cache/flask/.venv
.cache/flask/.venv/bin/pip install -q -e .cache/flask pytest
(cd .cache/flask && .venv/bin/python -c "import flask, sys; print(flask.__file__)")  # must point into .cache/flask/src
(cd .cache/flask && .venv/bin/pytest tests/test_cli.py -q | tail -2)                 # green before we touch it
```

## Exit check (paste the output into docs/progress/00-bootstrap.md)

- `npm run verify` → `verify: all stages passed`, with exactly `pending: perf, integration, e2e`
- `git ls-files | grep -E "node_modules|/out/|panel\.(js|css)"` prints nothing
- the TrueForge curl → `200`
- `rev-parse` → `22d92470`, and `pytest tests/test_cli.py -q` passes on the untouched clone
- Commit: `chore: bootstrap workspaces, gate and pins` (body: the version list, as rule 95 asks for new dependencies)
