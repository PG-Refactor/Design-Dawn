// Owns the "Project Tree width" app setting. Framework-free and,
// like the theme and auto-save controllers, outside the application store, document
// sessions and undo history: it is app-local layout, not Project data.

import { createStore, type Store } from "../../shared/store/store";
import { parseProjectTreeWidth } from "../local-state/project-tree-width";
import type { AppSettingsGateway } from "../ports/app-settings-gateway";
import {
  failWith,
  type OperationError,
  type OperationResult,
  settleOperation,
} from "../ports/operation-error";
import { createSerialQueue } from "../serial-queue";

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
  const enqueue = createSerialQueue().run;

  async function load(): Promise<void> {
    const result = await settleOperation(() => gateway.getAppSettings());
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
          return failWith(error);
        }
        const result = await settleOperation(() =>
          gateway.setProjectTreeWidth(width),
        );
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
