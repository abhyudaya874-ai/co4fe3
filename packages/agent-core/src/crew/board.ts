export interface BoardEntry { key: string; value: string; by: string; at: number }
export class Board {
  static readonly MAX_KEYS = 24; static readonly MAX_VALUE = 2000;
  private entries = new Map<string, BoardEntry>();

  write(key: string, value: string, by: string, at: number): { ok: true } | { ok: false; error: string } {
    if (!/^[a-z][a-z0-9_.-]{0,40}$/.test(key)) return { ok: false, error: `key must match ^[a-z][a-z0-9_.-]{0,40}$ (got "${key}")` };
    if (value.length > Board.MAX_VALUE) return { ok: false, error: `value is ${value.length} chars; the board keeps at most ${Board.MAX_VALUE}. Save the short fact, not the file.` };
    if (!this.entries.has(key) && this.entries.size >= Board.MAX_KEYS) return { ok: false, error: `the board is full (${Board.MAX_KEYS} keys). Overwrite an existing key or drop stale ones.` };
    this.entries.set(key, { key, value, by, at });
    return { ok: true };
  }

  /** A new session starts with an empty board. */
  clear(): void { this.entries.clear(); }
  read(key?: string): BoardEntry[] {
    if (key !== undefined) { const e = this.entries.get(key); return e ? [e] : []; }
    return [...this.entries.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
}
