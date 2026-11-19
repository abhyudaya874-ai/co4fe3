# 00 bootstrap

## Exit check
- [x] `npm run verify` → `verify: all stages passed`, with exactly `pending: perf, integration, e2e`
- [x] `git ls-files | grep -E "node_modules|/out/|panel\.(js|css)"` prints nothing (exit 1)
- [ ] HUMAN CHECK: TrueForge serves on :8790 — steps: run `npm run trueforge` in a spare terminal, wait for the banner, open http://localhost:8790 — expected: the TrueForge UI loads; `curl -s -o /dev/null -w "%{http_code}" http://localhost:8790/api/v1/docs` prints 200
- [x] `git -C .cache/flask rev-parse --short HEAD` → `22d92470`, and `.venv/bin/pytest tests/test_cli.py -q` passes on the untouched clone
- [x] Commit: `chore: bootstrap workspaces, gate and pins`

## Raw output

Machine check (step 1):

```
/dev/nvme0n1p6  175G  119G   50G  71% /
node v26.7.0 · Python 3.14.7 · rg, jq, git, code all present
test-hooks: 36 passed, 0 failed
invariants: ok (84 checks)
```

Full gate (step 5), after the pinned installs:

```
invariants: ok (117 checks)
[verify] invariants ok (0.1 s)
test-hooks: 36 passed, 0 failed
[verify] hooks ok (1.4 s)
[verify] typecheck ok (0.7 s)
[verify] unit ok (0.9 s)          (1 test: boot)
[verify] perf pending (its inputs arrive in workflow 09)
[verify] integration pending (its inputs arrive in workflow 01)
[verify] build ok (1.1 s)         out/extension.cjs 1.9kb · media/panel.js 218.84 kB · media/panel.css 0.12 kB
[verify] e2e pending (its inputs arrive in workflow 04)
[verify] pending: perf, integration, e2e
verify: all stages passed
```

Vite printed the known harmless warning: "ESM syntax in a file loaded as CommonJS (webview/vite.config.ts)". Left as is (no `"type"` added).

Installs (exact pins, 389 packages total, 0 vulnerabilities in the two core installs; 9 audit findings reported in the extension dev-deps install — all in packaging-only tools, noted for the write-up):

```
npm i -w @co4fe3/agent-core --save-exact @truefoundry/trueforge-sdk@0.185.0 @modelcontextprotocol/sdk@1.32.2 zod@4.6.7 diff@9.0.0   → added 98
npm i -D --save-exact typescript@7.0.2 vitest@5.1.1 fast-check@4.10.3 @fast-check/vitest@0.5.0 @types/node@22.20.5                  → added 43
npm i -D -w co4fe3-vscode --save-exact esbuild@0.28.2 vite@8.3.8 @vitejs/plugin-react@6.3.0 react@19.3.1 react-dom@19.3.1
  @types/react@19.3.0 @types/react-dom@19.3.0 @types/vscode@1.90.0 @vscode/test-cli@0.0.15 @vscode/test-electron@3.1.0
  @types/mocha@10.0.10 @vscode/vsce@4.1.1                                                                                          → added 245
```

npm 11 warned that esbuild's and @vscode/vsce-sign's postinstall scripts are not approved. Not approved (dry-run note); esbuild works anyway (the build ran).

TrueForge (step 6): `curl` prints `000` — down. The human was asked to run `npm run trueforge` in a spare terminal (first run downloads the package). Workflow 01 starts when it answers 200.

Flask rehearsal clone (step 7):

```
git -C .cache/flask rev-parse --short HEAD → 22d92470   (3.1.3, as required)
.cache/flask/.venv/bin/python -c "import flask; print(flask.__file__)"
  → /home/de3p/co4fe3/.cache/flask/src/flask/__init__.py
```

One environment fix, recorded here because the workflow's command did not work as written: the venv got pytest 9.2.0, and flask 3.1.3's `tests/test_cli.py` imports `from _pytest.monkeypatch import notset`, which pytest 9 removed. Fixed by pinning the **venv only** to `pytest<9` (8.4.2). No repo dependency changed. After the fix:

```
.venv/bin/pytest tests/test_cli.py -q
  → 55 passed, 3 skipped in 0.24s
```

EXIT: passed (21:41)
