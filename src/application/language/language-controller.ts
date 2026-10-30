// Owns the display language state: the saved preference and the derived language.
// Framework-free; applying the language to the UI is done by
// the caller. Like the theme, it is outside the application store, document sessions and
// undo history, and never uses the project persistence gateway.

import {
  DEFAULT_LANGUAGE_PREFERENCE,
  type DisplayLanguage,
  type LanguagePreference,
} from "../../config/language-config";
import { createStore, type Store } from "../../shared/store/store";
import type {
  AppSettingsGateway,
  AppSettingsSnapshot,
} from "../ports/app-settings-gateway";
import {
  type OperationError,
  type OperationResult,
  operationErr,
} from "../ports/operation-error";
import type { SystemLanguageSource } from "../ports/system-language-source";
import { resolveDisplayLanguage } from "./resolve-display-language";

export type LanguageStatus = "loading" | "ready";

export interface LanguageState {
  readonly preference: LanguagePreference;
  readonly language: DisplayLanguage;
  readonly status: LanguageStatus;
  // Why the stored settings were not used (or could not be read) at start-up.
  readonly loadIssue: OperationError | null;
  // Set when the last save failed; cleared by the next successful save.
  readonly saveError: OperationError | null;
}

export interface LanguageController {
  readonly store: Store<LanguageState>;
  // Never rejects: failures are recorded in the state and the default preference is kept.
  initialize(): Promise<void>;
  // The state changes only after the save succeeded.
  setPreference(
    preference: LanguagePreference,
  ): Promise<OperationResult<LanguagePreference>>;
  // Applies a preference another window already saved: no gateway call (the file is
  // already up to date), and nothing is queued.
  applyExternal(preference: LanguagePreference): void;
}

export interface LanguageControllerDependencies {
  readonly gateway: AppSettingsGateway;
  readonly systemLanguageSource: SystemLanguageSource;
}

// The gateway should return errors as values, but a rejection must not break start-up.
async function settle(
  request: () => Promise<OperationResult<AppSettingsSnapshot>>,
): Promise<OperationResult<AppSettingsSnapshot>> {
  try {
    return await request();
  } catch (error) {
    return operationErr(
      "unexpectedCommandError",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function createLanguageController(
  dependencies: LanguageControllerDependencies,
): LanguageController {
  const { gateway, systemLanguageSource } = dependencies;
  const store = createStore<LanguageState>({
    preference: DEFAULT_LANGUAGE_PREFERENCE,
    language: resolveDisplayLanguage(
      DEFAULT_LANGUAGE_PREFERENCE,
      systemLanguageSource.current(),
    ),
    status: "loading",
    loadIssue: null,
    saveError: null,
  });

  let initialization: Promise<void> | null = null;
  // Settings requests run one at a time so the last requested value is the one stored.
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  }

  // The system languages are read on every change of preference, so the language follows
  // the WebView's current setting rather than the one at construction time.
  function withPreference(
    state: LanguageState,
    preference: LanguagePreference,
  ): LanguageState {
    return {
      ...state,
      preference,
      language: resolveDisplayLanguage(
        preference,
        systemLanguageSource.current(),
      ),
    };
  }

  async function load(): Promise<void> {
    const result = await settle(() => gateway.getAppSettings());
    store.setState((state) => {
      if (!result.ok) {
        return { ...state, status: "ready", loadIssue: result.error };
      }
      return {
        ...withPreference(state, result.value.languagePreference),
        status: "ready",
        loadIssue: result.value.loadIssue,
      };
    });
  }

  return {
    store,
    initialize() {
      initialization ??= enqueue(load);
      return initialization;
    },
    setPreference(preference) {
      return enqueue(async () => {
        const result = await settle(() =>
          gateway.setLanguagePreference(preference),
        );
        if (!result.ok) {
          store.setState((state) => ({ ...state, saveError: result.error }));
          return result;
        }
        const saved = result.value.languagePreference;
        store.setState((state) => ({
          ...withPreference(state, saved),
          loadIssue: result.value.loadIssue,
          saveError: null,
        }));
        return { ok: true as const, value: saved };
      });
    },
    applyExternal(preference) {
      store.setState((state) => withPreference(state, preference));
    },
  };
}
