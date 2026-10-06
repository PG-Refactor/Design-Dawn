// Timer boundary so auto-save debouncing can be tested with a fake clock.
export interface Scheduler {
  // Runs `callback` once after `delayMs`. The returned function cancels it (no-op if it
  // already ran).
  schedule(delayMs: number, callback: () => void): () => void;
}
