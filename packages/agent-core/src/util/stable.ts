import { createHash } from "node:crypto";

/** Deterministic JSON: object keys sorted, so the same logical value always gives the same string. */
export function stableStringify(v: unknown): string {
  const seen = new Set<unknown>();
  const enc = (x: unknown): string => {
    if (x === null || typeof x !== "object") return JSON.stringify(x) ?? "null";
    if (seen.has(x)) throw new TypeError("stableStringify: circular reference");
    seen.add(x);
    try {
      if (Array.isArray(x)) return `[${x.map(enc).join(",")}]`;
      const keys = Object.keys(x as Record<string, unknown>).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${enc((x as Record<string, unknown>)[k])}`).join(",")}}`;
    } finally { seen.delete(x); }
  };
  return enc(v);
}

export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
