---
name: research-web
description: Find the source of truth for an SDK method, event field, VS Code API, MCP API or provider endpoint before writing it - installed .d.ts first, then official docs, never memory
argument-hint: "<the name or behaviour to confirm>"
agent: forge-scout
triggers:
  - user
  - model
---

Confirm: $ARGUMENTS

## Order of truth (stop at the first one that answers)

1. **Installed types**: `node_modules/<pkg>/**/*.d.ts`. Grep for the exact name.
   - TrueForge SDK: `node_modules/@truefoundry/trueforge-sdk/dist/cjs/api/`
   - MCP: `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`, `streamableHttp.d.ts`
   - VS Code: `node_modules/@types/vscode/index.d.ts`
   - jsdiff: `node_modules/diff/lib/index.d.ts`, or `@types/diff`
2. **Recorded reality**: `docs/progress/01-spike.md`, which shows what TrueForge actually sent.
2b. **Design precedent** (for "how should this work?", never for an API name): `docs/study/v3code.md`, then the
   V3Code file it cites, read-only under `/home/de3p/V3Code`. Report the idea, never paste its code (rule 05).
3. **Official docs**: `https://trueforge.dev/llms.txt` (the index), then the page it lists; `/api/v1/docs` on the
   running server; `code.visualstudio.com/api/references/vscode-api`.
4. **Package source on unpkg** at the pinned version (`https://unpkg.com/<pkg>@<version>/<path>`).

## Output contract

```
NAME:     <exact identifier or field path>
SHAPE:    <signature or type, copied, not paraphrased>
SOURCE:   <file path:line or URL>
VERIFIED: yes | UNVERIFIED (<what to run to verify>)
```

If the answer changes rule 20, CODEMAP or a pattern, say which file and line must change.

## Never

- Write an endpoint, header, event field or method from memory, even a "well-known" one.
- Trust a blog post over the `.d.ts`.
- Cite a page you did not open in this session.
