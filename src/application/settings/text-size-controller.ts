// Owns the UI text size app setting. Framework-free; applying the size to the page is done
// by the caller. Like the theme, it is outside the application store, document sessions
// and undo history: it is not Project data.

import {
  DEFAULT_TEXT_SIZE,
  type TextSize,
} from "../../config/text-size-config";
import { createStore, type Store } from "../../shared/store/store";
import type { AppSettingsGateway } from "../ports/app-settings-gateway";
import {
  type OperationError,
  type OperationResult,
  settleOperation,
} from "../ports/operation-error";
import { createSerialQueue } from "../serial-queue";

export type TextSizeStatus = "loading" | "ready";

export interface TextSizeState {
  readonly size: TextSize;
  readonly status: TextSizeStatus;
  // Why the stored settings were not used (or could not be read) at start-up.
  readonly loadIssue: OperationError | null;
  // Set when the last save failed; cleared by the next successful save.
  readonly saveError: OperationError | null;
}

export interface TextSizeController {
  readonly store: Store<TextSizeState>;
  // Never rejects: failures are recorded in the state and the default size is kept.
  initialize(): Promise<void>;
  // The state changes only after the save succeeded.
  setSize(size: TextSize): Promise<OperationResult<TextSize>>;
  // Applies a size another window already saved: no gateway call.
  applyExternal(size: TextSize): void;
}

export function createTextSizeController(dependencies: {
  readonly gateway: AppSettingsGateway;
}): TextSizeController {
  const { gateway } = dependencies;
  const store = createStore<TextSizeState>({
    size: DEFAULT_TEXT_SIZE,
    status: "loading",
    loadIssue: null,
    saveError: null,
  });
  let initialization: Promise<void> | null = null;
  // Requests run one at a time so the last requested value is the one stored.
  const enqueue = createSerialQueue().run;

  async function load(): Promise<void> {
    const result = await settleOperation(() => gateway.getAppSettings());
    store.setState((state) =>
      result.ok
        ? {
            ...state,
            size: result.value.textSize,
            status: "ready",
            loadIssue: result.value.loadIssue,
          }
        : { ...state, status: "ready", loadIssue: result.error },
    );
  }

  return {
    store,
    initialize() {
      initialization ??= enqueue(load);
      return initialization;
    },
    setSize(size) {
      return enqueue(async () => {
        const result = await settleOperation(() => gateway.setTextSize(size));
        if (!result.ok) {
          store.setState((state) => ({ ...state, saveError: result.error }));
          return result;
        }
        const saved = result.value.textSize;
        store.setState((state) => ({
          ...state,
          size: saved,
          loadIssue: result.value.loadIssue,
          saveError: null,
        }));
        return { ok: true as const, value: saved };
      });
    },
    applyExternal(size) {
      store.setState((state) => ({ ...state, size }));
    },
  };
}
