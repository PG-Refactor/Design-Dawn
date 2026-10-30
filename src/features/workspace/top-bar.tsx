import { useMemo } from "react";
import {
  THEME_PREFERENCES,
  type ThemePreference,
} from "../../application/local-state/theme";
import type { ApplicationState } from "../../application/state/application-state";
import { APP_CONFIG } from "../../config/app-config";
import {
  DISPLAY_LANGUAGE_NATIVE_NAMES,
  LANGUAGE_PREFERENCES,
  type LanguagePreference,
  SYSTEM_LANGUAGE_PREFERENCE,
} from "../../config/language-config";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { MenuBar } from "../menu-bar/menu-bar";
import type { MenuDefinition } from "../menu-bar/menu-bar-types";
import { Notifications } from "./notifications";
import { saveShortcutHint } from "./save-shortcut";
import type { UiState } from "./ui-state/ui-state";
import { useMessages } from "./use-messages";
import { useUiState, useWorkspaceModel } from "./workspace-hooks";
import type { WorkspaceMessages } from "./workspace-messages";
import { useWorkspaceServices } from "./workspace-services-context";
import "./top-bar.css";

const SAVE_SHORTCUT_KEYS = "Control+S Meta+S";

function themeLabel(
  topBar: WorkspaceMessages["topBar"],
  preference: ThemePreference,
): string {
  switch (preference) {
    case "system":
      return topBar.systemOption;
    case "light":
      return topBar.themeLight;
    case "dark":
      return topBar.themeDark;
  }
}

// Only "System" is translated; a language is named in itself so that it can be found
// without reading the current language.
function languageLabel(
  topBar: WorkspaceMessages["topBar"],
  preference: LanguagePreference,
): string {
  return preference === SYSTEM_LANGUAGE_PREFERENCE
    ? topBar.systemOption
    : DISPLAY_LANGUAGE_NATIVE_NAMES[preference];
}

const selectBusy = (ui: UiState) => ui.busy;
const selectProjectName = (application: ApplicationState) =>
  application.project?.project.name ?? null;

export function TopBar() {
  const messages = useMessages().workspace;
  const topBar = messages.topBar;
  const { actions, themeController, languageController, autoSaveController } =
    useWorkspaceServices();
  const projectName = useWorkspaceModel(selectProjectName);
  const busy = useUiState(selectBusy);
  const themePreference = useStoreSelector(
    themeController.store,
    (state) => state.preference,
  );
  const themeLoading = useStoreSelector(
    themeController.store,
    (state) => state.status === "loading",
  );
  const languagePreference = useStoreSelector(
    languageController.store,
    (state) => state.preference,
  );
  const languageLoading = useStoreSelector(
    languageController.store,
    (state) => state.status === "loading",
  );
  const autoSaveEnabled = useStoreSelector(
    autoSaveController.store,
    (state) => state.enabled,
  );
  const autoSaveLoading = useStoreSelector(
    autoSaveController.store,
    (state) => state.status === "loading",
  );
  const hasProject = projectName !== null;

  const menus = useMemo<readonly MenuDefinition[]>(
    () => [
      {
        id: "file",
        label: topBar.fileMenu,
        entries: [
          {
            kind: "item",
            id: "createProject",
            label: topBar.createProject,
            disabled: busy,
            onSelect: actions.requestCreateProject,
          },
          {
            kind: "item",
            id: "openProject",
            label: topBar.openProject,
            disabled: busy,
            onSelect: () => void actions.openProjectViaDialog(),
          },
          // Offered with or without a project: with one open it is the way to work on
          // another project side by side, without closing this one.
          {
            kind: "item",
            id: "openProjectInNewWindow",
            label: topBar.openProjectInNewWindow,
            disabled: busy,
            onSelect: () => void actions.openProjectInNewWindowViaDialog(),
          },
          { kind: "separator", id: "separator-save" },
          {
            kind: "item",
            id: "save",
            label: topBar.save,
            shortcutHint: saveShortcutHint(navigator.platform),
            shortcutKeys: SAVE_SHORTCUT_KEYS,
            disabled: !hasProject,
            // Failures are already recorded as operation / save errors by the action.
            onSelect: () => void actions.saveAll(),
          },
          {
            kind: "checkbox",
            id: "autoSave",
            label: topBar.autoSave,
            checked: autoSaveEnabled,
            disabled: autoSaveLoading,
            // A failed save is recorded in the controller state and shown as a
            // notification.
            onSelect: () =>
              void autoSaveController.setEnabled(!autoSaveEnabled),
          },
          { kind: "separator", id: "separator-close" },
          {
            kind: "item",
            id: "closeProject",
            label: topBar.closeProject,
            disabled: busy || !hasProject,
            onSelect: () => void actions.closeProject(),
          },
        ],
      },
      {
        id: "view",
        label: topBar.viewMenu,
        entries: [
          {
            kind: "radioGroup",
            id: "theme",
            label: topBar.themeLegend,
            value: themePreference,
            disabled: themeLoading,
            options: THEME_PREFERENCES.map((preference) => ({
              value: preference,
              label: themeLabel(topBar, preference),
            })),
            onSelect: (value) => {
              const next = THEME_PREFERENCES.find((item) => item === value);
              if (next !== undefined) void themeController.setPreference(next);
            },
          },
          { kind: "separator", id: "separator-language" },
          {
            kind: "radioGroup",
            id: "language",
            label: topBar.languageLegend,
            value: languagePreference,
            disabled: languageLoading,
            options: LANGUAGE_PREFERENCES.map((preference) => ({
              value: preference,
              label: languageLabel(topBar, preference),
            })),
            onSelect: (value) => {
              const next = LANGUAGE_PREFERENCES.find((item) => item === value);
              if (next !== undefined) {
                void languageController.setPreference(next);
              }
            },
          },
        ],
      },
    ],
    [
      topBar,
      actions,
      busy,
      hasProject,
      themeController,
      themePreference,
      themeLoading,
      languageController,
      languagePreference,
      languageLoading,
      autoSaveController,
      autoSaveEnabled,
      autoSaveLoading,
    ],
  );

  return (
    <header className="top-bar">
      <h1 className="top-bar__app-name">{APP_CONFIG.displayName}</h1>
      <MenuBar label={topBar.menubarLabel} menus={menus} />
      <p className="top-bar__project">{projectName ?? topBar.noProject}</p>
      <Notifications />
    </header>
  );
}
