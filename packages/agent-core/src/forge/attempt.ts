/** The UI surface an inline attempt reports into (rule 60: the UI follows one leader). */
export interface AttemptUi {
  onText(full: string, threadId: string): void;
  onStatus(s: string): void;
  onEvent?(e: unknown): void;
  onPause?(pending: unknown, index: unknown, signal: AbortSignal): Promise<unknown[]>;
}
