// Runs tasks one at a time, in the order they were queued, so the last request is the one
// that takes effect. A task that rejects hands its rejection to its own caller; the tasks
// behind it still run.
export interface SerialQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run(task) {
      const result = tail.then(task);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
