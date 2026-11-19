# BACKLOG

Things that are real but not for Round 1. Each entry has one line on why it is deferred. Add to this list instead
of refactoring "while you are here".

## After the Round 1 submission (Fri 20 Nov 23:59 IST)

- **The co4fe3 app, on a V3Code fork.** Fork `github.com/HeavenFYouMissed/V3Code` (Apache-2.0, on Void and Code-OSS).
  Rename it, because the V3Code name and logo are KandD Labs trademarks. Keep `LICENSE`, `LICENSE.txt`, `NOTICE.txt`
  and every file header, and add our own NOTICE entry. Then:
  - replace its native agent loop with TrueForge, reusing `packages/agent-core` unchanged;
  - ship this extension as a built-in extension first;
  - then move the panel into its workbench contrib (React is already bundled there).

  Its Beast retrieval, Turbo Draft and memory can then be used directly instead of reimplemented. Deferred because
  the first build alone costs hours (`npm ci`, `buildreact`, `compile`), and Round 1 requires an extension.
- **Tree-sitter symbols** (D7): better precision on decorators, nested code and more languages (V3Code's chunker uses
  web-tree-sitter with an 80-line window fallback).
- **Optional embeddings retrieval** as a fifth RRF channel, behind a setting (V3Code: a fast 256-d model first,
  a 1024-d model backfilled). It needs a model that TrueForge can
  serve for embeddings.
- **TrueForge sandbox, then native skills and Code Mode**, once local sandbox execution ships (it is on TrueForge's
  roadmap).
- **Multi-root workspaces**: today `EditorHost.root` is the first folder only.
- **Windows**: process-tree kill and path tests on a Windows runner.
- **Session history in the panel**: list and reopen past TrueForge sessions (`client.sessions.list`).

## Cut during Round 1 (filled in from rule 95's cut list when something is cut)

- ____
