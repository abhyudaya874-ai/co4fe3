import path from "node:path";

export class ToolInputError extends Error {}

const NEVER = [/^\.git(\/|$)/, /(^|\/)node_modules\//, /(^|\/)\.env(\..*)?$/, /\.(pem|key|p12)$/, /(^|\/)id_(rsa|ed25519)/];

/** Resolves `p` against `root` and refuses anything outside it, or a secrets/VCS path. Returns a workspace-relative path with "/" separators. */
export function jail(root: string, p: string): string {
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs).split(path.sep).join("/");
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) throw new ToolInputError(`${p} is outside the workspace.`);
  if (NEVER.some((r) => r.test(rel))) throw new ToolInputError(`${rel} is off limits (secrets or VCS internals).`);
  return rel;
}
