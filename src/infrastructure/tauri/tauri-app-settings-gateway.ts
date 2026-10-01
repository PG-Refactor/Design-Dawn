import type { AppSettingsGateway } from "../../application/ports/app-settings-gateway";
import { getAppSettings, setThemePreference } from "./local-state-client";

// Thin: `CommandResult` and `OperationResult` share one shape, so no conversion is needed.
export function createTauriAppSettingsGateway(): AppSettingsGateway {
  return { getAppSettings, setThemePreference };
}
