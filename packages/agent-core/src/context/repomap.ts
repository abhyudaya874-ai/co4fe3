import type { Sym } from "./symbols.js";

export interface FileEntry { path: string; tokens: number; syms: Sym[]; terms: Map<string, number>; uses: Set<string> }  // see workflow 06
export interface RepoIndex {
  files: FileEntry[];
  byPath: Map<string, FileEntry>;
  defs: Map<string, { path: string; line: number; sig: string }[]>;   // symbol name → its definitions
  users: Map<string, Set<string>>;                                     // symbol name → files that use it
  graph: Map<string, Map<string, number>>;                             // F → (G → weight): F uses a name that G defines
  idf: Map<string, number>;                                            // stemmed term → log(1 + N / (1 + df))
}
export interface RankQuery { text: string; mentioned: string[]; active?: string; recent: string[]; grepHits?: Map<string, number> }
export type Channel = "lexical" | "graph" | "grep" | "recent";
export const CHANNELS: readonly Channel[] = ["lexical", "graph", "grep", "recent"];
export interface Ranked { path: string; score: number; ranks: Record<Channel, number>; why: string[] }
