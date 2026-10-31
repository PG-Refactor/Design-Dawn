// Fakes for the theme ports: an in-memory settings "file" and a controllable OS theme.

import type { LanguagePreference } from "../../config/language-config";
import { LAYOUT_CONFIG } from "../../config/layout-config";
import {
  DEFAULT_TEXT_SIZE,
  type TextSize,
} from "../../config/text-size-config";
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
  languagePreference: LanguagePreference;
  textSize: TextSize;
  autoSave: boolean;
  projectTreeWidth: number;
  loadIssue: OperationError | null;
}

export interface FakeAppSettingsGateway extends AppSettingsGateway {
  readonly storage: FakeAppSettingsStorage;
  // Preferences passed to `setThemePreference`, in call order.
  readonly setCalls: ThemePreference[];
  failGet: OperationError | null;
  failSet: OperationError | null;
  // Preferences passed to `setLanguagePreference`, in call order.
  readonly languageCalls: LanguagePreference[];
  // Sizes passed to `setTextSize`, in call order.
  readonly textSizeCalls: TextSize[];
  // Values passed to `setAutoSave`, in call order.
  readonly autoSaveCalls: boolean[];
  // Values passed to `setProjectTreeWidth`, in call order.
  readonly projectTreeWidthCalls: number[];
  // Suspends the next set (theme, language, text size, auto-save or width) until the returned function is called.
  holdNextSet(): () => void;
}

export const FAKE_SETTINGS_ERROR: OperationError = {
  kind: "ioError",
  detail: "disk",
};

export function createFakeAppSettingsGateway(
  storage: FakeAppSettingsStorage = {
    themePreference: "system",
    languagePreference: "system",
    textSize: DEFAULT_TEXT_SIZE,
    autoSave: true,
    projectTreeWidth: LAYOUT_CONFIG.projectTree.defaultWidthPx,
    loadIssue: null,
  },
): FakeAppSettingsGateway {
  let releaseNext: Promise<void> | null = null;
  const snapshot = (): AppSettingsSnapshot => ({
    themePreference: storage.themePreference,
    languagePreference: storage.languagePreference,
    textSize: storage.textSize,
    autoSave: storage.autoSave,
    projectTreeWidth: storage.projectTreeWidth,
    loadIssue: storage.loadIssue,
  });
  // Shared by all setters: waits for a held request, then reports a configured failure.
  const settleSet = async () => {
    const hold = releaseNext;
    releaseNext = null;
    if (hold !== null) await hold;
    return gateway.failSet === null
      ? null
      : operationErr<AppSettingsSnapshot>(
          gateway.failSet.kind,
          gateway.failSet.detail,
        );
  };
  const gateway: FakeAppSettingsGateway = {
    storage,
    setCalls: [],
    languageCalls: [],
    textSizeCalls: [],
    autoSaveCalls: [],
    projectTreeWidthCalls: [],
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
      const failure = await settleSet();
      if (failure !== null) return failure;
      storage.themePreference = preference;
      storage.loadIssue = null;
      return operationOk(snapshot());
    },
    async setLanguagePreference(preference) {
      gateway.languageCalls.push(preference);
      const failure = await settleSet();
      if (failure !== null) return failure;
      storage.languagePreference = preference;
      storage.loadIssue = null;
      return operationOk(snapshot());
    },
    async setTextSize(size) {
      gateway.textSizeCalls.push(size);
      const failure = await settleSet();
      if (failure !== null) return failure;
      storage.textSize = size;
      storage.loadIssue = null;
      return operationOk(snapshot());
    },
    async setAutoSave(enabled) {
      gateway.autoSaveCalls.push(enabled);
      const failure = await settleSet();
      if (failure !== null) return failure;
      storage.autoSave = enabled;
      storage.loadIssue = null;
      return operationOk(snapshot());
    },
    async setProjectTreeWidth(width) {
      gateway.projectTreeWidthCalls.push(width);
      const failure = await settleSet();
      if (failure !== null) return failure;
      storage.projectTreeWidth = width;
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
