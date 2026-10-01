// Fakes for the theme ports: an in-memory settings "file" and a controllable OS theme.

import type { ResolvedTheme, ThemePreference } from "../local-state/theme";
import type {
  AppSettingsGateway,
  AppSettingsSnapshot,
} from "../ports/app-settings-gateway";
import {
  type OperationError,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type { OsThemeSource } from "../ports/os-theme-source";

export interface FakeAppSettingsStorage {
  themePreference: ThemePreference;
  loadIssue: OperationError | null;
}

export interface FakeAppSettingsGateway extends AppSettingsGateway {
  readonly storage: FakeAppSettingsStorage;
  // Preferences passed to `setThemePreference`, in call order.
  readonly setCalls: ThemePreference[];
  failGet: OperationError | null;
  failSet: OperationError | null;
  // Suspends the next `setThemePreference` until the returned function is called.
  holdNextSet(): () => void;
}

export const FAKE_SETTINGS_ERROR: OperationError = {
  kind: "ioError",
  detail: "disk",
};

export function createFakeAppSettingsGateway(
  storage: FakeAppSettingsStorage = {
    themePreference: "system",
    loadIssue: null,
  },
): FakeAppSettingsGateway {
  let releaseNext: Promise<void> | null = null;
  const snapshot = (): AppSettingsSnapshot => ({
    themePreference: storage.themePreference,
    loadIssue: storage.loadIssue,
  });
  const gateway: FakeAppSettingsGateway = {
    storage,
    setCalls: [],
    failGet: null,
    failSet: null,
    async getAppSettings() {
      if (gateway.failGet !== null) {
        return operationErr(gateway.failGet.kind, gateway.failGet.detail);
      }
      return operationOk(snapshot());
    },
    async setThemePreference(preference) {
      gateway.setCalls.push(preference);
      const hold = releaseNext;
      releaseNext = null;
      if (hold !== null) await hold;
      if (gateway.failSet !== null) {
        return operationErr(gateway.failSet.kind, gateway.failSet.detail);
      }
      storage.themePreference = preference;
      storage.loadIssue = null;
      return operationOk(snapshot());
    },
    holdNextSet() {
      let release: () => void = () => {};
      releaseNext = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
  return gateway;
}

export interface FakeOsThemeSource extends OsThemeSource {
  set(theme: ResolvedTheme | null): void;
  readonly listenerCount: () => number;
}

export function createFakeOsThemeSource(
  initial: ResolvedTheme | null,
): FakeOsThemeSource {
  let theme = initial;
  const listeners = new Set<(theme: ResolvedTheme) => void>();
  return {
    current: () => theme,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      theme = next;
      if (next !== null) for (const listener of [...listeners]) listener(next);
    },
    listenerCount: () => listeners.size,
  };
}
