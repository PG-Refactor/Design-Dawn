// Subscribers of an application signal. A listener that unsubscribes another one during a
// notification stops it from being called; a listener added during one waits for the next.

export interface ListenerSet<Event> {
  notify(event: Event): void;
  subscribe(listener: (event: Event) => void): () => void;
}

// Rethrown outside the notifying call so it surfaces as an unhandled error.
export function rethrowLater(failure: unknown): void {
  queueMicrotask(() => {
    throw failure;
  });
}

export function createListenerSet<Event>(
  reportListenerFailure: (failure: unknown) => void = rethrowLater,
): ListenerSet<Event> {
  const listeners = new Set<{ readonly listener: (event: Event) => void }>();
  return {
    notify(event) {
      for (const subscription of [...listeners]) {
        if (!listeners.has(subscription)) continue;
        try {
          subscription.listener(event);
        } catch (failure) {
          // A faulty subscriber must not abort the operation that is notifying (it may sit
          // between two disk steps), but the failure must not vanish either.
          reportListenerFailure(failure);
        }
      }
    },
    subscribe(listener) {
      const subscription = { listener };
      listeners.add(subscription);
      return () => {
        listeners.delete(subscription);
      };
    },
  };
}
