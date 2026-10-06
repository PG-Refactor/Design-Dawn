import type { ApplicationState } from "../../application/state/application-state";
import { APP_CONFIG } from "../../config/app-config";
import { AutoSaveSetting } from "../settings/auto-save-settings";
import { ThemeSettings } from "../theme/theme-settings";
import { Notifications } from "./notifications";
import type { UiState } from "./ui-state/ui-state";
import { useUiState, useWorkspaceModel } from "./workspace-hooks";
import { MESSAGES } from "./workspace-messages";
import { useWorkspaceServices } from "./workspace-services-context";
import "./top-bar.css";

const selectBusy = (ui: UiState) => ui.busy;
const selectProjectName = (application: ApplicationState) =>
  application.project?.project.name ?? null;

export function TopBar() {
  const { actions, themeController, autoSaveController } =
    useWorkspaceServices();
  const projectName = useWorkspaceModel(selectProjectName);
  const busy = useUiState(selectBusy);
  return (
    <header className="top-bar">
      <h1 className="top-bar__app-name">{APP_CONFIG.displayName}</h1>
      <p className="top-bar__project">
        {projectName ?? MESSAGES.topBar.noProject}
      </p>
      <div className="top-bar__actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void actions.openProjectViaDialog()}
        >
          {MESSAGES.topBar.openProject}
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={actions.requestCreateProject}
        >
          {MESSAGES.topBar.createProject}
        </button>
        {projectName === null ? null : (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void actions.closeProject()}
          >
            {MESSAGES.topBar.closeProject}
          </button>
        )}
      </div>
      <Notifications />
      <AutoSaveSetting controller={autoSaveController} />
      <ThemeSettings controller={themeController} />
    </header>
  );
}
