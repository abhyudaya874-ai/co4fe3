# 02 mcp-server

## Exit check
- [x] `modes.test.ts`, `policy.test.ts` and `truncate.test.ts` are green (rule 50 §1–§2, rule 40)
- [x] `packages/agent-core/test/mcp-tools.test.ts` covers each tool through `@modelcontextprotocol/sdk/client` over HTTP:
  - [x] 401 without a token, and 403 with a wrong Host (raw `http.request`, because undici forbids overriding Host)
  - [x] `tools/list` returns the 11 names in `TOOLS` order
  - [x] the jail refuses `../x` and `.env`
  - [x] read_file paging and search caps (50 hits)
  - [x] the 3rd identical call carries the policy reminder and the 5th is refused
  - [x] a 100,000-char result is bounded with the note
  - [x] propose_edit without a decision writes nothing
  - [x] pack_context with a fake `LspHost` that returns nothing falls back to the index (`source: index`)
- [x] `test/integration/mcp.test.ts`: TrueForge lists all 11 tools in TOOLS order, and a scripted `read_file` call reaches the handler
- [ ] HUMAN CHECK: in the Extension Development Host the status bar shows `TF ✓ 11 tools` — steps: press F5 (config "Run co4fe3 on minipkg"), wait ~5 s, look at the status bar — expected: `$(check) TF ✓ 11 tools`. Needs TrueForge running on :8790 (`npm run trueforge`).
- [x] Commit: `mcp: editor tool server with bearer auth, registered per window`

## Raw output

```
npm run verify:
  invariants: ok (384 checks)
  hooks: 36 passed, 0 failed
  typecheck ok · unit ok (11 files, 57 tests) · integration ok (13.1 s) · build ok
  out/extension.cjs 2.1mb (bundles agent-core + the two SDKs; fine for the dev host)
  verify: all stages passed (pending: perf, e2e)
```

mcp-tools.test.ts (9 tests):

```
✓ rejects 401 without a token and 403 with a wrong Host
✓ tools/list returns the 11 names in TOOLS order
✓ the jail refuses ../x and .env; read_file pages and says what to call next
✓ search_workspace caps at 50 hits and 200 chars per hit
✓ the 3rd identical call carries the reminder and the 5th is refused
✓ a 100,000-char result is bounded with the note
✓ propose_edit without a decision writes nothing
✓ pack_context falls back to the index when no language server answers (source: index)
✓ run_command refuses policy violations and runs plain commands
```

integration/mcp.test.ts through real TrueForge + fake model:

```
✓ TrueForge lists all 11 editor tools in TOOLS order, and a scripted read_file reaches our handler (403 ms)
  fake request log: #0 POST /chat/completions role=user · #1 POST /chat/completions role=tool
```

Notes for later workflows:

- The extension's `propose_edit` handler is wired to a **stub applier** until workflow 03 (`createApplier`); the
  integration harness uses a real `TestApplier`, so the write path is proven there.
- `repo_map` and `find_symbol` answer with the honest "index is still building" error until workflow 06 wires
  `index()`; `pack_context` already answers via LSP-or-index fallback.
- The MCP SDK's stateless transport accepted every request without a per-request initialize handshake (the
  client SDK sends it once per connection; TrueForge does the same).

EXIT: passed (22:06) · AWAITING HUMAN: status bar `TF ✓ 11 tools` in the Extension Development Host
