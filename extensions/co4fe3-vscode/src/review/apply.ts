import * as vscode from "vscode";
import * as path from "node:path";
import type { Applier, ApplyResult, FileChange, Proposal, Decision } from "@co4fe3/agent-core";
import { KeyedQueue, applyHunks } from "@co4fe3/agent-core";
import type { CheckpointLog } from "@co4fe3/agent-core";
import { currentText, fullRange } from "../host/editorHost.js";

/** The ONLY writer (law 3). One write at a time per path; every apply records a checkpoint; undo restores exact bytes. */
export function createApplier(root: string, log: CheckpointLog, onChange: () => void): Applier & { last(): ReturnType<CheckpointLog["last"]>; ofTurn(turnId: string): ReturnType<CheckpointLog["ofTurn"]> } {
  const q = new KeyedQueue();
  const uriOf = (rel: string): vscode.Uri => vscode.Uri.file(path.join(root, rel));
  const inside = (rel: string): boolean => {
    const abs = path.resolve(root, rel);
    return abs === root || abs.startsWith(root + path.sep);
  };
  const applier: Applier & { last(): ReturnType<CheckpointLog["last"]>; ofTurn(turnId: string): ReturnType<CheckpointLog["ofTurn"]> } = {
    apply: (c) => q.run(c.path, async (): Promise<ApplyResult> => {
      const uri = uriOf(c.path);                                     // c.path was jailed by the caller; re-check here
      if (!inside(c.path)) return { ok: false, why: "outside_root", detail: c.path };
      const current = await currentText(uri);                        // open buffer if any, else disk, else null
      if (current !== c.before) return { ok: false, why: "conflict", detail: `${c.path} changed after it was reviewed. Nothing was written.` };
      const edit = new vscode.WorkspaceEdit();
      if (c.before === null) edit.createFile(uri, { ignoreIfExists: false, contents: new TextEncoder().encode(c.after) });
      else {
        const doc = await vscode.workspace.openTextDocument(uri);
        edit.replace(uri, fullRange(doc), c.after);
      }
      if (!(await vscode.workspace.applyEdit(edit))) return { ok: false, why: "io", detail: "VS Code refused the edit" };
      await (await vscode.workspace.openTextDocument(uri)).save();    // whole file, one save: never half-written
      const cp = log.push({ path: c.path, before: c.before, after: c.after, turnId: c.turnId, reason: c.reason });
      onChange();                                                    // panel + status bar show "Undo"
      return { ok: true, checkpointId: cp.id };
    }),
    undo: (id) => {
      const cp = log.get(id);
      if (!cp) return Promise.resolve({ ok: false, why: "io", detail: `no checkpoint ${id}` });
      return q.run(cp.path, async (): Promise<ApplyResult> => {
        const uri = uriOf(cp.path);
        if (!inside(cp.path)) return { ok: false, why: "outside_root", detail: cp.path };
        const current = await currentText(uri);
        if (current !== cp.after) return { ok: false, why: "conflict", detail: `${cp.path} changed since it was applied; undo refused.` };
        const edit = new vscode.WorkspaceEdit();
        if (cp.before === null) {
          try { await vscode.workspace.fs.delete(uri); } catch { return { ok: false, why: "io", detail: "could not delete the created file" }; }
        } else {
          const doc = await vscode.workspace.openTextDocument(uri);
          edit.replace(uri, fullRange(doc), cp.before);
          if (!(await vscode.workspace.applyEdit(edit))) return { ok: false, why: "io", detail: "VS Code refused the undo" };
          await (await vscode.workspace.openTextDocument(uri)).save();
        }
        log.markUndone(id);
        onChange();
        return { ok: true, checkpointId: id };
      });
    },
    last: () => log.last(),
    ofTurn: (turnId) => log.ofTurn(turnId),
  };
  return applier;
}

/** Writes exactly the accepted hunks of a decided proposal (P6: the one way a decision reaches disk). */
export async function applyDecision(applier: Applier, p: Proposal, d: Decision): Promise<ApplyResult> {
  if (d.accepted.length === 0) return { ok: false, why: "io", detail: "no hunk was accepted; nothing to write" };
  const after = applyHunks(p.before ?? "", p.hunks, new Set(d.accepted));
  return await applier.apply({ path: p.path, before: p.before, after, turnId: p.turnId, reason: p.why });
}

/** Persists the checkpoint log to the extension's storageUri, so Undo survives a window reload (rule 30). */
export function saveCheckpoints(storage: vscode.Uri | undefined, json: string): void {
  if (!storage) return;
  void vscode.workspace.fs.writeFile(vscode.Uri.joinPath(storage, "checkpoints.json"), new TextEncoder().encode(json));
}
