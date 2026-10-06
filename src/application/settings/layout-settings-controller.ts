// Owns the "Project Tree width" app setting (docs/architecture.md §6.2.2). Framework-free and,
// like the theme and auto-save controllers, outside the application store, document
// sessions and undo history: it is app-local layout, not Project data.

import { createStore, type Store } from "../../shared/store/store";
import { parseProjectTreeWidth } from "../local-state/project-tree-width";
import type { AppSettingsGateway } from "../ports/app-settings-gateway";
import {
  type OperationError,
  type OperationResult,
  operationErr,
} from "../ports/operation-error";

export type LayoutSettingsStatus = "loading" | "ready";

export interface LayoutSettingsState {
  // The last width that is known to be stored (or the default until it is loaded).
  readonly projectTreeWidth: number;
  readonly status: LayoutSettingsStatus;
  // Why the stored settings were not used (or could not be read) at start-up.
  readonly loadIssue: OperationError | null;
  // Set when the last save failed; cleared by the next successful save.
  readonly saveError: OperationError | null;
}

export interface LayoutSettingsController {
  readonly store: Store<LayoutSettingsState>;
  // Never rejects: failures are recorded in the state and the default is kept.
  initialize(): Promise<void>;
  // The state changes only after the save succeeded, so a failure keeps the previous width.
  setProjectTreeWidth(width: number): Promise<OperationResult<number>>;
}

export interface LayoutSettingsControllerDependencies {
  readonly gateway: AppSettingsGateway;
  // The width used until the stored one is known; also the width of a missing file.
  readonly defaultProjectTreeWidth: number;
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

export function createLayoutSettingsController(
  dependencies: LayoutSettingsControllerDependencies,
): LayoutSettingsController {
  const { gateway, defaultProjectTreeWidth } = dependencies;
  const store = createStore<LayoutSettingsState>({
    projectTreeWidth: defaultProjectTreeWidth,
    status: "loading",
    loadIssue: null,
    saveError: null,
  });
  let initialization: Promise<void> | null = null;
  // Requests run one at a time so the last requested width is the one stored.
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
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
      projectTreeWidth: result.value.projectTreeWidth,
    }));
  }

  return {
    store,
    initialize() {
      initialization ??= enqueue(load);
      return initialization;
    },
    setProjectTreeWidth(width) {
      return enqueue(async () => {
        const parsed = parseProjectTreeWidth(width);
        if (!parsed.ok) {
          const error = parsed.error;
          store.setState((state) => ({ ...state, saveError: error }));
          return operationErr(error.kind, error.detail);
        }
        const result = await settle(() => gateway.setProjectTreeWidth(width));
        if (!result.ok) {
          store.setState((state) => ({ ...state, saveError: result.error }));
          return result;
        }
        store.setState((state) => ({
          ...state,
          loadIssue: result.value.loadIssue,
          saveError: null,
          projectTreeWidth: result.value.projectTreeWidth,
        }));
        return { ok: true as const, value: result.value.projectTreeWidth };
      });
    },
  };
}
