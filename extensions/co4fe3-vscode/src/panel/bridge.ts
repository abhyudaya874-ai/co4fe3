import type { PanelEvent } from "@co4fe3/agent-core/panel";
import { coalesce } from "@co4fe3/agent-core/panel";

/** 33 ms batches, snapshots only (rule 60 lever 10). Status changes flush at once. */
export class Bridge {
  private q: PanelEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private post: (batch: PanelEvent[]) => Thenable<boolean>, private everyMs = 33) {}
  push(e: PanelEvent): void {
    if (e.kind === "status") { this.q.push(e); this.flush(); return; }   // stopping/cancelled/done skip the wait
    this.q.push(e);
    this.timer ??= setTimeout(() => this.flush(), this.everyMs);
  }
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.q.length) return;
    const batch = coalesce(this.q); this.q = [];
    void this.post(batch);
  }
}
