---
description: Create the co4fe3 repo skeleton, pin every dependency, get the gate green, start TrueForge, and prepare the flask rehearsal clone
argument-hint: ""
---

# 00 Bootstrap

Goal: an empty but real repo where `npm run verify:fast` is green, `npm run trueforge` serves on :8790 and
`.cache/flask` is the pinned flask with a working venv. No product code yet.

## 1. Check the machine

```bash
df -h ~ | tail -1            # need ≥ 5 GB free
node -v                      # ≥ 22.14
python3 --version            # ≥ 3.9 for flask 3.1
command -v rg jq git code    # jq is needed by the hooks; rg is optional (VS Code ships one)
git -C /home/de3p/V3Code rev-parse --short HEAD   # the reference architecture (rule 05): expect 2eac91fb. Read-only; never build it.
bash scripts/hooks/test-hooks.sh                  # the guards work before anything else is written
```

If `/home/de3p/V3Code` is missing, the pack still works (`docs/study/v3code.md` holds the map). Clone it read-only
for reference: `git clone https://github.com/HeavenFYouMissed/V3Code /home/de3p/V3Code`. If its HEAD moved past
`2eac91fb`, re-read the files the study cites before relying on a line number.

## 2. Root files (copy exactly; versions are pinned at install time with --save-exact)

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
    "trueforge": "npx --yes @truefoundry/trueforge@PINNED",
    "setup:trueforge": "node scripts/setup-trueforge.mjs",
    "bench:latency": "node scripts/bench-latency.mjs",
    "typecheck": "tsc -p packages/agent-core && tsc -p extensions/co4fe3-vscode && tsc -p test",
    "build": "npm run build -w co4fe3-vscode",
    "verify": "node scripts/verify.mjs",
    "verify:fast": "node scripts/verify.mjs --fast",
    "verify:live": "node scripts/verify.mjs --live"
  }
}
```

Replace `PINNED` with the output of `npm view @truefoundry/trueforge version` and write that version into
`docs/DECISIONS.md` (D2).

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

Each of `packages/agent-core`, `extensions/co4fe3-vscode` and `test` has a `tsconfig.json` that `extends` this file
and sets `include` (plus `"types": ["node"]`, and in the extension also `"vscode"`). Nothing is emitted by tsc.
esbuild bundles the extension, Vite bundles the webview, and vitest runs TS directly (decision D9).

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

`.gitignore`:

```
node_modules/
out/
dist/
media/panel.*
*.vsix
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

## 3. Workspaces

```bash
mkdir -p packages/agent-core/{src,test} extensions/co4fe3-vscode/{src,webview,test,media} test/{fakes,fixtures,integration} docs/progress agents config
```

`packages/agent-core/package.json`:

```json
{
  "name": "@co4fe3/agent-core",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts", "./panel": "./src/panel/index.ts" }
}
```

The exports point at TypeScript source on purpose. esbuild, Vite and vitest all read `.ts`, so agent-core has no
build step and no stale `dist/`.

Install with exact pins (the guard hook blocks unpinned installs):

```bash
npm i -w @co4fe3/agent-core --save-exact @truefoundry/trueforge-sdk@0.185.0 @modelcontextprotocol/sdk@1 zod diff
npm i -D --save-exact typescript vitest fast-check @fast-check/vitest @types/node@22 @types/diff
```

Then read `node_modules/@modelcontextprotocol/sdk/package.json` `peerDependencies`. If it pins a zod major, reinstall
zod at that major. Record every installed version in `docs/DECISIONS.md` (D2).

The extension's `package.json` is in the `vscode-extension` skill. Copy it whole.

## 4. Gate and hooks

The pack already ships `scripts/verify.mjs`, `scripts/check-invariants.mjs` and `scripts/hooks/*.sh`. Make the hooks
executable and prove the gate runs:

```bash
chmod +x scripts/hooks/*.sh
echo 'import { it, expect } from "vitest"; it("boots", () => expect(1).toBe(1));' > packages/agent-core/test/boot.test.ts
npm run verify:fast
```

## 5. TrueForge

```bash
npm run trueforge            # leave running in its own terminal; first run downloads the package
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8790/api/v1/docs    # 200
```

Open http://localhost:8790 once and confirm the UI loads. Do not configure models by hand. Workflow 08's setup
script does that. For the spike, run the step 2 setup from workflow 01.

## 6. The rehearsal target (flask 3.1.3)

```bash
git clone https://github.com/pallets/flask .cache/flask
git -C .cache/flask checkout 3.1.3 && git -C .cache/flask rev-parse --short HEAD    # must print 22d92470
python3 -m venv .cache/flask/.venv
.cache/flask/.venv/bin/pip install -q -e .cache/flask pytest
(cd .cache/flask && .venv/bin/python -c "import flask, sys; print(flask.__file__)")  # must point into .cache/flask/src
(cd .cache/flask && .venv/bin/pytest tests/test_cli.py -q | tail -2)                 # green before we touch it
```

## Exit check (paste the output into docs/progress/00-bootstrap.md)

- `npm run verify:fast` → `verify (fast): all stages passed`
- the TrueForge curl → `200`
- `rev-parse` → `22d92470`, and `pytest tests/test_cli.py -q` passes on the untouched clone
- Commit: `chore: bootstrap workspaces, gate and pins`
