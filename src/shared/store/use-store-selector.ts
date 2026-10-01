import { useCallback, useRef, useSyncExternalStore } from "react";
import type { Store } from "./store";

export type EqualityFunction<S> = (previous: S, next: S) => boolean;

export interface SelectionCache<T, S> {
  readonly state: T;
  readonly selector: (state: T) => S;
  readonly selected: S;
}

// `useSyncExternalStore` requires getSnapshot to return the same value until the store
// changes, otherwise React re-renders forever. This keeps the previous selection when the
// state is the same reference, and also when a new state yields an equal selection
// (so a selector building a fresh object does not cause re-renders).
export function readSelection<T, S>(
  cache: SelectionCache<T, S> | null,
  state: T,
  selector: (state: T) => S,
  isEqual: EqualityFunction<S>,
): SelectionCache<T, S> {
  if (cache !== null && cache.state === state && cache.selector === selector) {
    return cache;
  }
  const selected = selector(state);
  if (cache !== null && isEqual(cache.selected, selected)) {
    return { state, selector, selected: cache.selected };
  }
  return { state, selector, selected };
}

export function useStoreSelector<T, S>(
  store: Store<T>,
  selector: (state: T) => S,
  isEqual: EqualityFunction<S> = Object.is,
): S {
  const cacheRef = useRef<SelectionCache<T, S> | null>(null);
  const getSnapshot = useCallback((): S => {
    cacheRef.current = readSelection(
      cacheRef.current,
      store.getState(),
      selector,
      isEqual,
    );
    return cacheRef.current.selected;
  }, [store, selector, isEqual]);
  // The server snapshot is the same read: there is no separate server-side state.
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
