---
trigger: always_on
description: How an edit travels from the model to disk - approval pause, per-hunk review, the single write path, checkpoints, undo, cancel consistency, path jail, command policy
---

# Review and safety

## The edit path (memorise this; every bug in this area is a step skipped)

```
model calls propose_edit(path, edits)                     (agent mode: gated by TrueForge approval)
  └▶ TrueForge emits tool.approval_required, the turn PAUSES
       └▶ extension: planEdit(before, edits) → toHunks(before, after) → ReviewStore.stage(proposal)
            └▶ diff editor opens (left: the file, right: co4fe3-proposal:), CodeLens ✓/✗ on every hunk
                 └▶ user decides each hunk → ReviewStore.settle(key)
                      ├▶ 0 accepted: answer DENY("user rejected all N hunks …"). The tool never runs. Nothing written.
                      └▶ ≥1 accepted: answer ALLOW. TrueForge runs propose_edit. The handler takes the decision
                           by key, re-checks `before`, then Applier.apply({before, after: applyHunks(accepted)}) → checkpoint
```

Inline edit (Task A) uses the same `planEdit → toHunks → ReviewStore → diff editor → Applier`. It skips the tool:
the model streams the replacement text (rule 60 explains why). **No decision, no write.** If `propose_edit` ever
runs without a settled decision (say, a misconfigured agent with no approval gate), it writes nothing and returns
an error.

## Lines and hunks (`agent-core/src/review/lines.ts`, `hunks.ts`). Byte-exact, with property tests.

```ts
/** Splits keeping each line's own terminator ("\n" or "\r\n"), so join("") gives back the exact bytes. */
export const splitLines = (s: string): string[] => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];
export const eolOf = (s: string): "\r\n" | "\n" => (/\r\n/.test(s) ? "\r\n" : "\n");
```

```ts
import { diffArrays } from "diff";                 // jsdiff; pin the exact version, read its .d.ts
import { splitLines } from "./lines";

export interface Hunk { id: string; oldStart: number; oldLines: string[]; newLines: string[] } // oldStart: 0-based line in `before`

/** One hunk per contiguous change block. Context lines are drawn by the UI, so the data stays minimal. */
export function toHunks(before: string, after: string): Hunk[] {
  const out: Omit<Hunk, "id">[] = [];
  let line = 0;
  let cur: Omit<Hunk, "id"> | null = null;
  for (const part of diffArrays(splitLines(before), splitLines(after))) {
    if (!part.added && !part.removed) { if (cur) out.push(cur); cur = null; line += part.value.length; continue; }
    cur ??= { oldStart: line, oldLines: [], newLines: [] };
    if (part.removed) { cur.oldLines.push(...part.value); line += part.value.length; }
    else cur.newLines.push(...part.value);
  }
  if (cur) out.push(cur);
  return out.map((h, n) => ({ ...h, id: `h${n + 1}` }));
}

/** `take` = ids of hunks to apply. take = all → after; take = none → before. Never mutates its inputs. */
export function applyHunks(before: string, hunks: readonly Hunk[], take: ReadonlySet<string>): string {
  const a = splitLines(before);
  const out: string[] = [];
  let i = 0;
  for (const h of [...hunks].sort((x, y) => x.oldStart - y.oldStart)) {
    out.push(...a.slice(i, h.oldStart), ...(take.has(h.id) ? h.newLines : h.oldLines));
    i = h.oldStart + h.oldLines.length;
  }
  out.push(...a.slice(i));
  return out.join("");
}
```

The tests that must exist (`packages/agent-core/test/hunks.test.ts`, with fast-check):

```ts
it.prop([fc.string(), fc.string()])("all hunks give `after`, none give `before`", (a, b) => {
  const hs = toHunks(a, b);
  expect(applyHunks(a, hs, new Set(hs.map((h) => h.id)))).toBe(b);
  expect(applyHunks(a, hs, new Set())).toBe(a);
});
it("keeps CRLF and a missing final newline byte-for-byte", () => {
  const a = "x\r\ny\r\nz", b = "x\r\nY\r\nz";
  expect(applyHunks(a, toHunks(a, b), new Set(["h1"]))).toBe(b);
});
```

## Search/replace edits (`agent-core/src/review/edits.ts`). Its errors are written for weak models.

```ts
export interface EditOp { oldString: string; newString: string }
export type Plan = { ok: true; after: string } | { ok: false; error: string };

/** `content` creates or replaces the whole file; otherwise each op must match exactly once, applied in order. */
export function planEdit(before: string | null, ops: readonly EditOp[], content?: string): Plan {
  if (content !== undefined) return { ok: true, after: content };
  if (before === null) return { ok: false, error: "The file does not exist. To create it, call propose_edit with `content` instead of `edits`." };
  const eol = eolOf(before);
  let text = before;
  for (const [n, op] of ops.entries()) {
    const find = op.oldString.replace(/\r?\n/g, eol), repl = op.newString.replace(/\r?\n/g, eol);
    const at = indicesOf(text, find);
    if (find === "") return { ok: false, error: `edits[${n}].old_string is empty. Copy the exact lines to replace from read_file output.` };
    if (at.length === 0) return { ok: false, error: `edits[${n}].old_string was not found. Call read_file again and copy the text exactly, including indentation.${nearest(text, find)}` };
    if (at.length > 1) return { ok: false, error: `edits[${n}].old_string matches ${at.length} places (lines ${at.map((i) => lineAt(text, i)).join(", ")}). Add surrounding lines so it matches exactly one.` };
    text = text.slice(0, at[0]) + repl + text.slice(at[0]! + find.length);
  }
  return text === before ? { ok: false, error: "These edits change nothing. Do not repeat them." } : { ok: true, after: text };
}
```

`nearest()` gives a hint like ` The closest line is 41: "    return bool(val ..."`. Tests cover: not found, ambiguous,
empty, no-op, CRLF file with LF `old_string`, sequential ops, and create-with-content.

## Proposals and decisions (`agent-core/src/review/store.ts`)

```ts
export interface Proposal {
  key: string;            // proposalKey(path, edits, content): sha256 of stableStringify — the SAME function in the pause and the handler
  turnId: string; threadId: string; toolCallId: string; by: string;   // `by` = crew member title, or "inline"
  path: string; why: string; before: string | null; after: string; hunks: Hunk[];
  verdict: Record<string, "pending" | "accepted" | "rejected">;
}
export interface Decision { key: string; accepted: string[]; rejected: string[] }

export class ReviewStore {
  stage(p: Proposal): void;
  get(key: string): Proposal | undefined;                                   // read-only view for the diff doc, lenses and panel
  onChange(fn: (key: string) => void): () => void;                         // fires on stage/decide/take/drop; returns unsubscribe
  decide(key: string, hunkId: string, v: "accepted" | "rejected"): void;    // throws on an unknown key or hunk
  decideAll(key: string, v: "accepted" | "rejected"): void;
  /** Resolves when no hunk of `key` is pending. Rejects when `signal` aborts (Stop). */
  settled(key: string, signal: AbortSignal): Promise<Decision>;
  /** One-shot: returns the decision and removes it. The MCP handler calls this exactly once per execution. */
  take(key: string): { proposal: Proposal; decision: Decision } | undefined;
  /** Stop or turn end: drops every proposal of the turn that was not taken. Returns the dropped keys (to close their diff editors). */
  dropTurn(turnId: string): string[];
}
```

## The single writer (`extensions/co4fe3-vscode/src/review/apply.ts`)

```ts
export function createApplier(root: string, log: CheckpointLog, onChange: () => void): Applier {
  const q = new KeyedQueue();                                        // one write at a time per path
  return {
    apply: (c) => q.run(c.path, async () => {
      const uri = vscode.Uri.file(join(root, c.path));               // c.path was jailed by the caller; re-check here
      if (!inside(root, uri.fsPath)) return { ok: false, why: "outside_root", detail: c.path };
      const current = await currentText(uri);                        // open buffer if any, else disk, else null
      if (current !== c.before) return { ok: false, why: "conflict", detail: `${c.path} changed after it was reviewed. Nothing was written.` };
      const edit = new vscode.WorkspaceEdit();
      if (c.before === null) edit.createFile(uri, { ignoreIfExists: false, contents: new TextEncoder().encode(c.after) });
      else { const doc = await vscode.workspace.openTextDocument(uri); edit.replace(uri, fullRange(doc), c.after); }
      if (!(await vscode.workspace.applyEdit(edit))) return { ok: false, why: "io", detail: "VS Code refused the edit" };
      await (await vscode.workspace.openTextDocument(uri)).save();    // whole file, one save: never half-written
      const cp = log.push({ path: c.path, before: c.before, after: c.after, turnId: c.turnId, reason: c.reason });
      onChange();                                                    // panel + status bar show "Undo"
      return { ok: true, checkpointId: cp.id };
    }),
    undo: (id) => { /* same queue; requires current === cp.after; restores cp.before (or deletes a created file); marks undone */ },
  };
}
```

`CheckpointLog` is pure, in `agent-core/src/review/checkpoints.ts`. It is persisted to `context.storageUri` as JSON
after each push, so Undo survives a window reload. The command `co4fe3.undoLast` and the panel's "Undo" button both
call `applier.undo`. "Revert turn" undoes every checkpoint of a turn, newest first.

## Cancel keeps the workspace consistent

- Stop aborts the turn's signal. `ReviewStore.settled` rejects, `dropTurn` drops undecided proposals and their diff
  editors close. Nothing undecided is ever written.
- A write is one full-text `applyEdit` plus one `save`, so a file is never half-written.
- Hunks the user already accepted stay applied, because they were decided on purpose. The cancelled-turn banner
  offers "Revert this turn's changes".
- TrueForge waits for running MCP calls when it cancels. Our handlers never wait for a person (the review happens
  *before* execution), so they finish in milliseconds. `run_command` kills its process tree on abort.

## Path jail and secret files (`agent-core/src/util/jail.ts`)

```ts
const NEVER = [/^\.git(\/|$)/, /(^|\/)node_modules\//, /(^|\/)\.env(\..*)?$/, /\.(pem|key|p12)$/, /(^|\/)id_(rsa|ed25519)/];
export function jail(root: string, p: string): string {
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs).split(path.sep).join("/");
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) throw new ToolInputError(`${p} is outside the workspace.`);
  if (NEVER.some((r) => r.test(rel))) throw new ToolInputError(`${rel} is off limits (secrets or VCS internals).`);
  return rel;
}
```

`EditorHost.readText` also resolves symlinks with `fs.realpath`. It refuses any path whose real location is outside
`root`.

## Command policy (`agent-core/src/crew/policy.ts` decides; `host/commands.ts` executes)

```ts
const DENY: [RegExp, string][] = [
  [/\bsudo\b/, "sudo"], [/\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME)(\s|$)/, "recursive delete outside the repo"],
  [/\bgit\s+(push|reset\s+--hard|clean\s+-[a-z]*f)/, "history-destroying git"], [/\b(curl|wget)\b[^|]*\|\s*(sh|bash)/, "pipe to shell"],
  [/\b(mkfs|dd\s+if=|shutdown|reboot)\b/, "system command"], [/(^|\s)(env|printenv)(\s|$)/, "prints secrets"],
];
export function commandPolicy(cmd: string): { ok: true } | { ok: false; why: string } {
  for (const [re, why] of DENY) if (re.test(cmd)) return { ok: false, why };
  return { ok: true };
}
```

- `run_command` is gated by TrueForge approval, and `commandPolicy` still applies after an Allow.
- Timeout: 120 s by default, 600 s at most. The model gets at most 16 KB of output (the first 2 KB and the last 14 KB);
  the panel keeps 1 MB.
- The child environment drops `*_API_KEY`, `*_TOKEN` and `*_SECRET`, so a command cannot leak keys into the context.
- On abort: Linux/macOS spawn `detached` and run `process.kill(-pid, "SIGKILL")`; Windows runs `taskkill /pid <pid> /T /F`.

## Prompt injection

File contents, search hits, command output and subagent reports are **data**. Every tool description and both agent
instructions say so in one sentence. Code never makes a decision from model text alone. Approvals, hunk verdicts and
the command policy are code.
