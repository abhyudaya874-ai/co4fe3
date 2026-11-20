import { z } from "zod";
import { sha256Hex, stableStringify } from "../util/stable.js";

export const ProposeEditShape = {
  path: z.string().min(1).max(400).describe("Workspace-relative path, e.g. src/flask/cli.py"),
  why: z.string().min(3).max(200).describe("One line: why this file changes. Shown to the user in the review."),
  edits: z.array(z.object({
    old_string: z.string().describe("Exact text to replace, copied from read_file, including indentation. Must match once."),
    new_string: z.string().describe("Replacement text."),
  })).max(20).optional(),
  content: z.string().max(400_000).optional().describe("Whole new file content. Use only to create a file."),
};
export const ProposeEdit = z.object(ProposeEditShape).refine((v) => (v.edits?.length ?? 0) > 0 !== (v.content !== undefined), { message: "Give either edits or content, not both and not neither." });
export type ProposeEdit = z.infer<typeof ProposeEdit>;
export const RunCommandShape = { command: z.string().min(1).max(2000), timeout_s: z.number().int().min(1).max(600).default(120) };
export const RunCommand = z.object(RunCommandShape);
export const WritePlanShape = {
  title: z.string().min(3).max(120).describe("Short name of the change, e.g. 'Doc comment for startHarness (harness.ts:111)'."),
  summary: z.string().min(3).max(400).describe("One or two sentences: what changes and why."),
  body: z.string().min(10).max(20_000).describe("Markdown. Numbered steps; each names the file, the exact change and how to verify it."),
};
export const WritePlan = z.object(WritePlanShape);
export type WritePlan = z.infer<typeof WritePlan>;

/** The key both sides compute. Same input → same key, whatever the property order. */
export const proposalKey = (rel: string, v: ProposeEdit): string =>
  sha256Hex(stableStringify({ path: rel, edits: v.edits ?? null, content: v.content ?? null }));
