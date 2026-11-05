import type { WindowTitle } from "../../application/ports/window-title";
import { COMMANDS } from "./command-constants";
import { commandOk } from "./command-error";
import { call } from "./invoke-command";

// Rust builds the title ("Design Dawn (name)") so the format lives in one place.
export function createTauriWindowTitle(): WindowTitle {
  return {
    showProject: (projectName) =>
      call(COMMANDS.showProjectInTitle, { projectName }, () =>
        commandOk(undefined),
      ),
    applyTheme: (themePreference) =>
      call(COMMANDS.applyWindowTheme, { themePreference }, () =>
        commandOk(undefined),
      ),
  };
}
