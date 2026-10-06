// A controllable `AutoSavePolicy` for tests that switch auto-save off and on.

import type { AutoSavePolicy } from "../ports/auto-save-policy";

export interface FakeAutoSavePolicy extends AutoSavePolicy {
  set(enabled: boolean): void;
}

export function createFakeAutoSavePolicy(initial = true): FakeAutoSavePolicy {
  let enabled = initial;
  const listeners = new Set<(enabled: boolean) => void>();
  return {
    isEnabled: () => enabled,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      if (next === enabled) return;
      enabled = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}
