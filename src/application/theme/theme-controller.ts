// Owns the theme state: the saved preference, the OS theme and the derived applied theme
// (docs/architecture.md §13). Framework-free; applying the theme to the UI is done by the
// caller. Theme is deliberately outside the application store, document sessions and
// undo history, and never uses the project persistence gateway.

import { createStore, type Store } from "../../shared/store/store";
import {
  DEFAULT_THEME_PREFERENCE,
  type ResolvedTheme,
  resolveTheme,
  type ThemePreference,
} from "../local-state/theme";
import type {
  AppSettingsGateway,
  AppSettingsSnapshot,
} from "../ports/app-settings-gateway";
import {
  type OperationError,
  type OperationResult,
  operationErr,
} from "../ports/operation-error";
import type { OsThemeSource } from "../ports/os-theme-source";

export type ThemeStatus = "loading" | "ready";

export interface ThemeState {
  readonly preference: ThemePreference;
  // Last known OS theme; remembered while a fixed theme is selected.
  readonly osTheme: ResolvedTheme | null;
  readonly resolvedTheme: ResolvedTheme;
  readonly status: ThemeStatus;
  // Why the stored settings were not used (or could not be read) at start-up.
  readonly loadIssue: OperationError | null;
  // Set when the last save failed; cleared by the next successful save.
  readonly saveError: OperationError | null;
}

export interface ThemeController {
  readonly store: Store<ThemeState>;
  // Never rejects: failures are recorded in the state and the default preference is kept.
  initialize(): Promise<void>;
  // The state changes only after the save succeeded.
  setPreference(
    preference: ThemePreference,
  ): Promise<OperationResult<ThemePreference>>;
  // Applies a preference another window already saved: no gateway call (the file is
  // already up to date), and nothing is queued.
  applyExternal(preference: ThemePreference): void;
  dispose(): void;
}

export interface ThemeControllerDependencies {
  readonly gateway: AppSettingsGateway;
  readonly osThemeSource: OsThemeSource;
}

function withPreference(
  state: ThemeState,
  preference: ThemePreference,
  osTheme: ResolvedTheme | null,
): ThemeState {
  return {
    ...state,
    preference,
    osTheme,
    resolvedTheme: resolveTheme(preference, osTheme),
  };
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

export function createThemeController(
  dependencies: ThemeControllerDependencies,
): ThemeController {
  const { gateway, osThemeSource } = dependencies;
  const initialOsTheme = osThemeSource.current();
  const store = createStore<ThemeState>({
    preference: DEFAULT_THEME_PREFERENCE,
    osTheme: initialOsTheme,
    resolvedTheme: resolveTheme(DEFAULT_THEME_PREFERENCE, initialOsTheme),
    status: "loading",
    loadIssue: null,
    saveError: null,
  });

  let unsubscribeOsTheme: (() => void) | null = null;
  let initialization: Promise<void> | null = null;
  // Settings requests run one at a time so the last requested value is the one stored.
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  }

  function onOsThemeChange(theme: ResolvedTheme): void {
    store.setState((state) => withPreference(state, state.preference, theme));
  }

  async function load(): Promise<void> {
    const result = await settle(() => gateway.getAppSettings());
    store.setState((state) => {
      if (!result.ok) {
        return { ...state, status: "ready", loadIssue: result.error };
      }
      return {
        ...withPreference(state, result.value.themePreference, state.osTheme),
        status: "ready",
        loadIssue: result.value.loadIssue,
      };
    });
  }

  return {
    store,
    initialize() {
      if (initialization === null) {
        // Re-read in case the OS theme changed since the controller was created.
        const osTheme = osThemeSource.current();
        store.setState((state) =>
          withPreference(state, state.preference, osTheme),
        );
        unsubscribeOsTheme = osThemeSource.subscribe(onOsThemeChange);
        initialization = enqueue(load);
      }
      return initialization;
    },
    setPreference(preference) {
      return enqueue(async () => {
        const result = await settle(() =>
          gateway.setThemePreference(preference),
        );
        if (!result.ok) {
          store.setState((state) => ({ ...state, saveError: result.error }));
          return result;
        }
        const saved = result.value.themePreference;
        store.setState((state) => ({
          ...withPreference(state, saved, state.osTheme),
          loadIssue: result.value.loadIssue,
          saveError: null,
        }));
        return { ok: true as const, value: saved };
      });
    },
    applyExternal(preference) {
      store.setState((state) =>
        withPreference(state, preference, state.osTheme),
      );
    },
    dispose() {
      unsubscribeOsTheme?.();
      unsubscribeOsTheme = null;
    },
  };
}
