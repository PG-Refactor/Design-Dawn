import type { AppSettingsGateway } from "../../application/ports/app-settings-gateway";
import {
  getAppSettings,
  setAutoSave,
  setLanguagePreference,
  setProjectTreeWidth,
  setTextSize,
  setThemePreference,
} from "./local-state-client";

// Thin: `CommandResult` and `OperationResult` share one shape, so no conversion is needed.
export function createTauriAppSettingsGateway(): AppSettingsGateway {
  return {
    getAppSettings,
    setThemePreference,
    setLanguagePreference,
    setTextSize,
    setAutoSave,
    setProjectTreeWidth,
  };
}
