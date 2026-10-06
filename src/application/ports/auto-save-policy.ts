// Whether metadata changes are saved automatically (docs/architecture.md §10.1). A port so
// the document sessions never depend on where the app setting is stored.

export interface AutoSavePolicy {
  isEnabled(): boolean;
  // The listener is called with the new value whenever it changes. Returns the unsubscribe.
  subscribe(listener: (enabled: boolean) => void): () => void;
}

// Auto-save is on by default; also what tests and callers without a setting use.
export const ALWAYS_ENABLED_AUTO_SAVE_POLICY: AutoSavePolicy = {
  isEnabled: () => true,
  subscribe: () => () => {},
};
