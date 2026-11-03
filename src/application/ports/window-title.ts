// Port for the window's own title bar (the one with the close button): it names the
// Project the window has open.

import type { OperationResult } from "./operation-error";

export interface WindowTitle {
  // `null`: no Project, only the app name.
  showProject(projectName: string | null): Promise<OperationResult<void>>;
}
