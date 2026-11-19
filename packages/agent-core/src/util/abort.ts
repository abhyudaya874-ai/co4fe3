/** Sleep that wakes early when `signal` aborts. Never rejects. */
export function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    const onAbort = () => done();
    function done(): void { clearTimeout(t); signal?.removeEventListener("abort", onAbort); resolve(); }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
