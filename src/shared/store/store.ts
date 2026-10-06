// A tiny framework-free store (docs/architecture.md §8.1). React binds to it through
// `useStoreSelector`; the application layer uses it without any React dependency.

export type Listener = () => void;

export type StateUpdate<T> = T | ((previous: T) => T);

export interface Store<T> {
  getState(): T;
  // Listeners run only when the state reference actually changes.
  setState(next: StateUpdate<T>): void;
  subscribe(listener: Listener): () => void;
}

function isUpdater<T>(next: StateUpdate<T>): next is (previous: T) => T {
  return typeof next === "function";
}

export function createStore<T extends object>(initialState: T): Store<T> {
  let state = initialState;
  // One entry object per subscription so the same function can subscribe twice and each
  // unsubscribe removes only its own entry.
  const subscriptions = new Set<{ readonly listener: Listener }>();

  return {
    getState: () => state,
    setState(next) {
      const nextState = isUpdater(next) ? next(state) : next;
      if (Object.is(nextState, state)) return;
      state = nextState;
      // Iterate a copy and re-check membership: a listener that unsubscribes another
      // (or itself) during notification must stop that listener from being called.
      for (const subscription of [...subscriptions]) {
        if (subscriptions.has(subscription)) subscription.listener();
      }
    },
    subscribe(listener) {
      const subscription = { listener };
      subscriptions.add(subscription);
      return () => {
        subscriptions.delete(subscription);
      };
    },
  };
}
