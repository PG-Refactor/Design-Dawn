// Owns the "auto-save on/off" app setting and is the
// `AutoSavePolicy` the document sessions read. Framework-free and, like the theme, outside
// the application store, document sessions and undo history: it is not Project data.

import { createStore, type Store } from "../../shared/store/store";
import type { AppSettingsGateway } from "../ports/app-settings-gateway";
import type { AutoSavePolicy } from "../ports/auto-save-policy";
import {
  type OperationError,
  type OperationResult,
  operationErr,
} from "../ports/operation-error";

export type AutoSaveStatus = "loading" | "ready";

export interface AutoSaveState {
  readonly enabled: boolean;
  readonly status: AutoSaveStatus;
  // Why the stored settings were not used (or could not be read) at start-up.
  readonly loadIssue: OperationError | null;
  // Set when the last save failed; cleared by the next successful save.
  readonly saveError: OperationError | null;
}

export interface AutoSaveController extends AutoSavePolicy {
  readonly store: Store<AutoSaveState>;
  // Never rejects: failures are recorded in the state and the default (on) is kept.
  initialize(): Promise<void>;
  // The state changes only after the save succeeded.
  setEnabled(enabled: boolean): Promise<OperationResult<boolean>>;
  // Applies a value another window already saved: no gateway call. Listeners fire only on
  // a change, so switching auto-save on makes the sessions save what is pending.
  applyExternal(enabled: boolean): void;
}

export interface AutoSaveControllerDependencies {
  readonly gateway: AppSettingsGateway;
  // The value used until the stored one is known; also the value of a missing file.
  readonly defaultEnabled: boolean;
}

// The gateway should return errors as values, but a rejection must not break start-up.
async function settle<T>(
  request: () => Promise<OperationResult<T>>,
): Promise<OperationResult<T>> {
  try {
    return await request();
  } catch (error) {
    return operationErr(
      "unexpectedCommandError",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function createAutoSaveController(
  dependencies: AutoSaveControllerDependencies,
): AutoSaveController {
  const { gateway, defaultEnabled } = dependencies;
  const store = createStore<AutoSaveState>({
    enabled: defaultEnabled,
    status: "loading",
    loadIssue: null,
    saveError: null,
  });
  const listeners = new Set<(enabled: boolean) => void>();
  let initialization: Promise<void> | null = null;
  // Requests run one at a time so the last requested value is the one stored.
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  }

  // Notifies only on a real change, so a no-op save does not restart anything.
  function applyEnabled(enabled: boolean): void {
    const changed = store.getState().enabled !== enabled;
    store.setState((state) => ({ ...state, enabled }));
    if (changed) for (const listener of [...listeners]) listener(enabled);
  }

  async function load(): Promise<void> {
    const result = await settle(() => gateway.getAppSettings());
    if (!result.ok) {
      store.setState((state) => ({
        ...state,
        status: "ready",
        loadIssue: result.error,
      }));
      return;
    }
    store.setState((state) => ({
      ...state,
      status: "ready",
      loadIssue: result.value.loadIssue,
    }));
    applyEnabled(result.value.autoSave);
  }

  return {
    store,
    isEnabled: () => store.getState().enabled,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize() {
      initialization ??= enqueue(load);
      return initialization;
    },
    applyExternal: applyEnabled,
    setEnabled(enabled) {
      return enqueue(async () => {
        const result = await settle(() => gateway.setAutoSave(enabled));
        if (!result.ok) {
          store.setState((state) => ({ ...state, saveError: result.error }));
          return result;
        }
        store.setState((state) => ({
          ...state,
          loadIssue: result.value.loadIssue,
          saveError: null,
        }));
        applyEnabled(result.value.autoSave);
        return { ok: true as const, value: result.value.autoSave };
      });
    },
  };
}
