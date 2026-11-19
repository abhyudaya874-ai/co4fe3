/** One async task at a time per key (per path for writes). Calls queue in order; results keep their own promise. */
export class KeyedQueue {
  private chains = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);   // a failed predecessor must not block the next write
    this.chains.set(key, next.catch(() => undefined));
    return next;
  }
}
