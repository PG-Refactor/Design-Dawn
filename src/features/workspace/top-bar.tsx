import type { ApplicationState } from "../../application/state/application-state";
import { APP_CONFIG } from "../../config/app-config";
import { LanguageSettings } from "../language/language-settings";
import { AutoSaveSetting } from "../settings/auto-save-settings";
import {
  type ThemePreferenceLabels,
  ThemeSettings,
} from "../theme/theme-settings";
import { Notifications } from "./notifications";
import type { UiState } from "./ui-state/ui-state";
import { useMessages } from "./use-messages";
import { useUiState, useWorkspaceModel } from "./workspace-hooks";
import type { WorkspaceMessages } from "./workspace-messages";
import { useWorkspaceServices } from "./workspace-services-context";
import "./top-bar.css";

function themeLabels(
  topBar: WorkspaceMessages["topBar"],
): ThemePreferenceLabels {
  return {
    system: topBar.systemOption,
    light: topBar.themeLight,
    dark: topBar.themeDark,
  };
}

const selectBusy = (ui: UiState) => ui.busy;
const selectProjectName = (application: ApplicationState) =>
  application.project?.project.name ?? null;

export function TopBar() {
  const messages = useMessages().workspace;
  const { actions, themeController, languageController, autoSaveController } =
    useWorkspaceServices();
  const projectName = useWorkspaceModel(selectProjectName);
  const busy = useUiState(selectBusy);
  return (
    <header className="top-bar">
      <h1 className="top-bar__app-name">{APP_CONFIG.displayName}</h1>
      <p className="top-bar__project">
        {projectName ?? messages.topBar.noProject}
      </p>
      <div className="top-bar__actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void actions.openProjectViaDialog()}
        >
          {messages.topBar.openProject}
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={actions.requestCreateProject}
        >
          {messages.topBar.createProject}
        </button>
        {/* Shown with or without a project: with one open it is the way to work on
            another project side by side, without closing this one. */}
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void actions.openProjectInNewWindowViaDialog()}
        >
          {messages.topBar.openProjectInNewWindow}
        </button>
        {projectName === null ? null : (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void actions.closeProject()}
          >
            {messages.topBar.closeProject}
          </button>
        )}
      </div>
      <Notifications />
      <AutoSaveSetting controller={autoSaveController} />
      <LanguageSettings
        controller={languageController}
        legend={messages.topBar.languageLegend}
        systemLabel={messages.topBar.systemOption}
      />
      <ThemeSettings
        controller={themeController}
        legend={messages.topBar.themeLegend}
        labels={themeLabels(messages.topBar)}
      />
    </header>
  );
}
