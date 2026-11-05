// Port for the window's own title bar (the one with the close button): it names the
// Project the window has open and is drawn to match the theme.

import type { ThemePreference } from "../local-state/theme";
import type { OperationResult } from "./operation-error";

export interface WindowTitle {
  // `null`: no Project, only the app name.
  showProject(projectName: string | null): Promise<OperationResult<void>>;
  // Light or dark like the theme; `system` leaves it to the OS.
  applyTheme(preference: ThemePreference): Promise<OperationResult<void>>;
}
