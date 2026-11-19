export type MarkName = "enter" | "session" | "created" | "firstDelta" | "firstTool" | "review" | "done";
export class Marks {
  private t = new Map<MarkName, number>();
  constructor(private now: () => number = () => performance.now()) {}
  mark(n: MarkName): void { if (!this.t.has(n)) this.t.set(n, this.now()); }   // first occurrence wins
  span(a: MarkName, b: MarkName): number | null { const x = this.t.get(a), y = this.t.get(b); return x === undefined || y === undefined ? null : Math.round(y - x); }
  line(model: string): string { return `perf ttft=${this.span("enter", "firstDelta")} created=${this.span("enter", "created")} total=${this.span("enter", "done")} model=${model}`; }
}
