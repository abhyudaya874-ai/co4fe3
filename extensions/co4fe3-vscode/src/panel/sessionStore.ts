import { mkdirSync, readFileSync } from "node:fs";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { HubStore, PersistedSession, SessionSummary } from "@co4fe3/agent-core/panel";

/** Ids come from the webview (switchSession, deleteSession): only this shape ever reaches a file name. */
export const isSessionId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9][a-z0-9-]{3,39}$/.test(id);

const KEEP = 40;                                                  // newest sessions kept per workspace

/**
 * Transcripts as one JSON file each, plus a small index so the sidebar lists without parsing them.
 * Lives under the extension's own storage folder (never the workspace), so it is not a workspace write (law 3).
 */
export class FileSessionStore implements HubStore {
  private index: SessionSummary[] | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(private dir: string, private log: (l: string) => void) {}

  private file(id: string): string { return join(this.dir, `${id}.json`); }
  private indexFile(): string { return join(this.dir, "index.json"); }

  private items(): SessionSummary[] {
    if (this.index) return this.index;
    try {
      mkdirSync(this.dir, { recursive: true });
      const raw = JSON.parse(readFileSync(this.indexFile(), "utf8")) as { items?: SessionSummary[] };
      this.index = (raw.items ?? []).filter((s) => isSessionId(s.id) && typeof s.title === "string" && typeof s.updatedAt === "number").map((s) => ({ ...s, running: false }));
    } catch { this.index = []; }                                  // first run or a damaged index: start empty, files stay on disk
    return this.index;
  }

  list(): SessionSummary[] { return this.items().map((s) => ({ ...s })); }

  async load(id: string): Promise<PersistedSession | null> {
    if (!isSessionId(id)) return null;
    try {
      const s = JSON.parse(await readFile(this.file(id), "utf8")) as PersistedSession;
      return s.v === 1 && s.id === id && Array.isArray(s.events) ? s : null;
    } catch { return null; }
  }

  put(s: PersistedSession): void {
    if (!isSessionId(s.id)) return;
    const items = this.items().filter((x) => x.id !== s.id);
    items.unshift({ id: s.id, title: s.title, updatedAt: s.updatedAt, running: false });
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    const dropped = items.splice(KEEP);
    this.index = items;
    this.queue(async () => {
      mkdirSync(this.dir, { recursive: true });
      await atomicWrite(this.file(s.id), JSON.stringify(s));
      await atomicWrite(this.indexFile(), JSON.stringify({ items }));
      for (const d of dropped) await rm(this.file(d.id), { force: true });
    });
  }

  remove(id: string): void {
    if (!isSessionId(id)) return;
    this.index = this.items().filter((x) => x.id !== id);
    const items = this.index;
    this.queue(async () => {
      await rm(this.file(id), { force: true });
      await atomicWrite(this.indexFile(), JSON.stringify({ items }));
    });
  }

  /** Writes run one after another, so two quick saves never interleave. A failed write is logged, never thrown. */
  private queue(job: () => Promise<void>): void {
    this.chain = this.chain.then(job).catch((e) => this.log(`session store: ${String(e).slice(0, 200)}`));
  }

  /** Resolves when every queued write has finished (deactivate waits for it). */
  settled(): Promise<void> { return this.chain; }
}

async function atomicWrite(path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}
