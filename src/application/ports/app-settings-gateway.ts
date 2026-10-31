// Port for the application settings stored outside any project. Separate from the persistence gateway: settings never touch project data.

import type { LanguagePreference } from "../../config/language-config";
import type { TextSize } from "../../config/text-size-config";
import type { ThemePreference } from "../local-state/theme";
import type { OperationError, OperationResult } from "./operation-error";

export interface AppSettingsSnapshot {
  readonly themePreference: ThemePreference;
  readonly languagePreference: LanguagePreference;
  readonly textSize: TextSize;
  readonly autoSave: boolean;
  // Project Tree panel width in CSS pixels.
  readonly projectTreeWidth: number;
  // Why the stored file could not be used; the preference next to it is then the default.
  readonly loadIssue: OperationError | null;
}

export interface AppSettingsGateway {
  getAppSettings(): Promise<OperationResult<AppSettingsSnapshot>>;
  setThemePreference(
    preference: ThemePreference,
  ): Promise<OperationResult<AppSettingsSnapshot>>;
  setLanguagePreference(
    preference: LanguagePreference,
  ): Promise<OperationResult<AppSettingsSnapshot>>;
  setTextSize(
    textSize: TextSize,
  ): Promise<OperationResult<AppSettingsSnapshot>>;
  setAutoSave(enabled: boolean): Promise<OperationResult<AppSettingsSnapshot>>;
  setProjectTreeWidth(
    width: number,
  ): Promise<OperationResult<AppSettingsSnapshot>>;
}
