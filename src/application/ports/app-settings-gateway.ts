// Port for the application settings stored outside any project (docs/architecture.md
// §6.2.2). Separate from the persistence gateway: settings never touch project data.

import type { ThemePreference } from "../local-state/theme";
import type { OperationError, OperationResult } from "./operation-error";

export interface AppSettingsSnapshot {
  readonly themePreference: ThemePreference;
  // Why the stored file could not be used; the preference next to it is then the default.
  readonly loadIssue: OperationError | null;
}

export interface AppSettingsGateway {
  getAppSettings(): Promise<OperationResult<AppSettingsSnapshot>>;
  setThemePreference(
    preference: ThemePreference,
  ): Promise<OperationResult<AppSettingsSnapshot>>;
}
