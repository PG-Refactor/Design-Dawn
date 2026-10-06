import type { Scheduler } from "../../application/ports/scheduler";

export function createTimeoutScheduler(): Scheduler {
  return {
    schedule(delayMs, callback) {
      const handle = setTimeout(callback, delayMs);
      return () => clearTimeout(handle);
    },
  };
}
