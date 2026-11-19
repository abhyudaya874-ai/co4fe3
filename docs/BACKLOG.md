# BACKLOG

Things that are real but not for Round 1. Each entry has one line on why it is deferred. Add to this list instead
of refactoring "while you are here".

## After the Round 1 submission (Fri 20 Nov 23:59 IST)

- **The co4fe3 app**: an agent-first desktop IDE on Code-OSS (or Theia) that reuses `packages/agent-core` unchanged.
  An agent view sits first and the editor second, with a mode toggle, a titlebar model picker and a sessions list.
  Start by shipping this extension as a built-in extension of the fork. Deferred because the first Code-OSS build
  alone costs hours, and it scores nothing in Round 1.
- **Tree-sitter symbols** (D7): better precision on decorators, nested code and more languages.
- **Optional embeddings retrieval** as a third ranking signal, behind a setting. It needs a model that TrueForge can
  serve for embeddings.
- **TrueForge sandbox, then native skills and Code Mode**, once local sandbox execution ships (it is on TrueForge's
  roadmap).
- **Multi-root workspaces**: today `EditorHost.root` is the first folder only.
- **Windows**: process-tree kill and path tests on a Windows runner.
- **Session history in the panel**: list and reopen past TrueForge sessions (`client.sessions.list`).

## Cut during Round 1 (filled in from rule 95's cut list when something is cut)

- ____
