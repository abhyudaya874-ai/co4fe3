export interface Checkpoint { id: string; path: string; before: string | null; after: string; turnId: string; reason: string; at: number; undone: boolean }
export class CheckpointLog {
  constructor(private now: () => number = Date.now, private items: Checkpoint[] = []) {}
  push(c: Omit<Checkpoint, "id" | "at" | "undone">): Checkpoint { const cp = { ...c, id: `cp${this.items.length + 1}-${this.now().toString(36)}`, at: this.now(), undone: false }; this.items.push(cp); return cp; }
  get(id: string): Checkpoint | undefined { return this.items.find((c) => c.id === id); }
  last(): Checkpoint | undefined { return [...this.items].reverse().find((c) => !c.undone); }
  ofTurn(turnId: string): Checkpoint[] { return this.items.filter((c) => c.turnId === turnId && !c.undone).reverse(); }  // newest first, for "revert turn"
  markUndone(id: string): void { const c = this.get(id); if (c) c.undone = true; }
  toJSON(): Checkpoint[] { return this.items.slice(-200); }
}
