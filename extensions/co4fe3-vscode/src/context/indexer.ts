import type { EditorHost, FileEntry, RepoIndex, ContextPack } from "@co4fe3/agent-core";
import { indexFile, buildIndex, rankFiles, grepTerms, assemblePack, parseMentions, withinBudget, BUDGET, EMPTY_PACK } from "@co4fe3/agent-core";

const INDEXABLE = /\.(py|ts|tsx|js|mjs|md|rst|toml|cfg|txt)$/;
const MAX_FILE = 300_000;

/** The workspace symbol index. `ready()` resolves when the first build lands; `update` re-indexes one file. */
export class IndexStore {
  private ix: RepoIndex | null = null;
  private resolveReady: ((ix: RepoIndex) => void) | null = null;
  private readyP: Promise<RepoIndex> | null = null;

  get(): RepoIndex | null { return this.ix; }

  ready(): Promise<RepoIndex> {
    if (this.ix) return Promise.resolve(this.ix);
    this.readyP ??= new Promise((res) => { this.resolveReady = res; });
    return this.readyP;
  }

  set(ix: RepoIndex): void {
    this.ix = ix;
    this.resolveReady?.(ix);
  }

  /** One file changed: the entry is re-parsed by the caller; the maps rebuild over the existing entries (cheap). */
  update(entry: FileEntry): void {
    if (!this.ix) return;
    this.set(buildIndex([...this.ix.files.filter((f) => f.path !== entry.path), entry]));
  }

  /** A file was deleted outside our applier: drop its entry. */
  remove(path: string): void {
    if (!this.ix?.byPath.has(path)) return;
    this.set(buildIndex(this.ix.files.filter((f) => f.path !== path)));
  }
}

/** Activation background build: files in chunks of 50, yielding between chunks so the editor never stutters. */
export async function indexWorkspaceInBackground(host: EditorHost, store: IndexStore, out: { info(l: string): void }): Promise<void> {
  const t = performance.now();
  try {
    const files = (await host.listFiles(5000)).filter((p) => INDEXABLE.test(p));
    const entries: FileEntry[] = [];
    for (let i = 0; i < files.length; i += 50) {
      for (const p of files.slice(i, i + 50)) {
        const text = await host.readText(p);
        if (text !== null && text.length <= MAX_FILE) entries.push(indexFile(p, text));
      }
      await new Promise((r) => setImmediate(r));                  // let the editor breathe
    }
    store.set(buildIndex(entries));
    out.info(`perf index.build ${Math.round(performance.now() - t)}ms files=${entries.length}`);
  } catch (e) {
    out.info(`index build failed: ${String(e).slice(0, 200)}`);
  }
}

/** The rule-40 retrieval budget: full ranking under 800 ms (index + grep), else a lexical-only pack under 200 ms, else none. */
export class ContextPacks {
  constructor(
    private host: EditorHost,
    private store: IndexStore,
    private budget: () => number,
    private out: { info(l: string): void },
  ) {}

  /** `recent` = the open editors plus this session's checkpoint paths, newest first (the caller assembles it). */
  async packFor(text: string, active?: string, recent: string[] = []): Promise<ContextPack> {
    const budget = () => Math.min(BUDGET.packCap, this.budget());
    const full = async (): Promise<ContextPack> => {
      const ix = await this.store.ready();                        // resolves when the first build is done
      const { pins, folderFiles, clean } = parseMentions(text, ix);
      const grepHits = new Map<string, number>();
      const ac = new AbortController();
      for (const term of grepTerms(ix, clean, 3)) {              // the 3 rarest index-present request terms
        for (const h of await this.host.search({ pattern: term, maxHits: 200 }, ac.signal)) {
          grepHits.set(h.path, (grepHits.get(h.path) ?? 0) + 1);
        }
      }
      return { ...assemblePack(ix, rankFiles(ix, { text: clean, mentioned: [...pins.map((p) => p.path), ...folderFiles], active, recent, grepHits }), pins, budget()), path: "full" as const };
    };
    const quick = async (): Promise<ContextPack> => {
      const ix = this.store.get();
      if (!ix) throw new Error("no index");
      const { pins, folderFiles, clean } = parseMentions(text, ix);
      return { ...assemblePack(ix, rankFiles(ix, { text: clean, mentioned: [...pins.map((p) => p.path), ...folderFiles], active, recent }), pins, budget()), path: "quick" as const };   // no grep, no wait
    };
    const r = await withinBudget(full, quick, { ...EMPTY_PACK, path: "none" as const, budget: budget() }, { fullMs: BUDGET.retrieveFullMs, quickMs: BUDGET.retrieveQuickMs });
    this.out.info(`perf agent.pack path=${r.path} items=${r.value.items.length} used=${r.value.used}`);
    return r.value;
  }
}
