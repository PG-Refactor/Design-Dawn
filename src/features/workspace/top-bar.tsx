import { useCallback, useMemo, useState } from "react";
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
import { TEXT_SIZES, type TextSize } from "../../config/text-size-config";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { AiAccessDialog } from "../ai-access/ai-access-dialog";
import { AiAccessRequestPrompt } from "../ai-access/ai-access-request-prompt";
import { PrintDialog, type PrintTarget } from "../export/print-dialog";
import { type HelpDialogKind, HelpDialogs } from "../help/help-dialogs";
import { MenuBar } from "../menu-bar/menu-bar";
import type { MenuDefinition } from "../menu-bar/menu-bar-types";
import { useMermaidRenderer } from "../mermaid/mermaid-renderer-context";
import { Notifications } from "./notifications";
import { saveEverything } from "./save-everything";
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

function textSizeLabel(
  topBar: WorkspaceMessages["topBar"],
  size: TextSize,
): string {
  switch (size) {
    case "small":
      return topBar.textSizeSmall;
    case "medium":
      return topBar.textSizeMedium;
    case "large":
      return topBar.textSizeLarge;
    case "xlarge":
      return topBar.textSizeXLarge;
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
const selectActiveDocumentId = (ui: UiState) => ui.activeDocumentId;
const selectActiveSheets = (ui: UiState) => ui.activeSheetIdByDocument;
const selectProjectName = (application: ApplicationState) =>
  application.project?.project.name ?? null;

export function TopBar() {
  const allMessages = useMessages();
  const messages = allMessages.workspace;
  const topBar = messages.topBar;
  const aiAccessTexts = allMessages.aiAccess;
  const {
    actions,
    themeController,
    languageController,
    textSizeController,
    autoSaveController,
    viewportPersistence,
    exportActions,
    applicationStore,
  } = useWorkspaceServices();
  const activeDocumentId = useUiState(selectActiveDocumentId);
  const activeSheets = useUiState(selectActiveSheets);
  const exportMessages = allMessages.export;
  const mermaidRenderer = useMermaidRenderer();
  const [printTarget, setPrintTarget] = useState<PrintTarget | null>(null);

  // The shown Document and sheet, with the names and order the exports need.
  const shownTarget = useCallback((): PrintTarget | null => {
    if (activeDocumentId === null) return null;
    const sheetId = activeSheets.get(activeDocumentId);
    const application = applicationStore.getState();
    const document = application.documents.get(activeDocumentId);
    const sheetIds = (
      application.documentDetails.get(activeDocumentId)?.sheetEntries ?? []
    )
      .filter((entry) => entry.state === "loaded")
      .map((entry) => entry.sheetId);
    const sheet =
      sheetId === undefined ? undefined : document?.sheets.get(sheetId);
    if (
      document === undefined ||
      sheetId === undefined ||
      sheet === undefined
    ) {
      return null;
    }
    return {
      documentId: activeDocumentId,
      documentName:
        application.project?.documents.find(
          (entry) => entry.documentId === activeDocumentId,
        )?.name ?? "",
      sheetId,
      sheetName: sheet.name,
      sheetIds,
    };
  }, [activeDocumentId, activeSheets, applicationStore]);

  const exportHtml = useCallback(
    (scope: "sheet" | "document"): void => {
      const target = shownTarget();
      if (target === null) return;
      void exportActions.exportSheetsHtml({
        renderer: mermaidRenderer,
        documentId: target.documentId,
        sheetIds: scope === "sheet" ? [target.sheetId] : target.sheetIds,
        title:
          scope === "sheet"
            ? `${target.documentName} - ${target.sheetName}`
            : target.documentName,
      });
    },
    [shownTarget, exportActions, mermaidRenderer],
  );
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
  const textSize = useStoreSelector(
    textSizeController.store,
    (state) => state.size,
  );
  const textSizeLoading = useStoreSelector(
    textSizeController.store,
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
  const [helpDialog, setHelpDialog] = useState<HelpDialogKind | null>(null);
  const [aiAccessOpen, setAiAccessOpen] = useState(false);

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
            onSelect: () =>
              void saveEverything({ actions, viewportPersistence }),
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
          { kind: "separator", id: "separator-export" },
          {
            kind: "item",
            id: "exportMarkdown",
            label: topBar.exportMarkdown,
            disabled: activeDocumentId === null,
            onSelect: () => {
              if (activeDocumentId !== null) {
                void exportActions.exportDocumentMarkdown(activeDocumentId);
              }
            },
          },
          {
            kind: "item",
            id: "exportSheetHtml",
            label: exportMessages.sheetHtml,
            disabled: activeDocumentId === null,
            onSelect: () => exportHtml("sheet"),
          },
          {
            kind: "item",
            id: "exportDocumentHtml",
            label: exportMessages.documentHtml,
            disabled: activeDocumentId === null,
            onSelect: () => exportHtml("document"),
          },
          {
            kind: "item",
            id: "print",
            label: exportMessages.print,
            disabled: activeDocumentId === null,
            onSelect: () => setPrintTarget(shownTarget()),
          },
          { kind: "separator", id: "separator-ai" },
          {
            kind: "item",
            id: "aiAccess",
            label: aiAccessTexts.menuItem,
            onSelect: () => setAiAccessOpen(true),
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
          { kind: "separator", id: "separator-text-size" },
          {
            kind: "radioGroup",
            id: "textSize",
            label: topBar.textSizeLegend,
            value: textSize,
            disabled: textSizeLoading,
            options: TEXT_SIZES.map((size) => ({
              value: size,
              label: textSizeLabel(topBar, size),
            })),
            // A failed save is recorded in the controller state and shown as a
            // notification.
            onSelect: (value) => {
              const next = TEXT_SIZES.find((item) => item === value);
              if (next !== undefined) void textSizeController.setSize(next);
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
      {
        id: "help",
        label: topBar.helpMenu,
        entries: [
          {
            kind: "item",
            id: "about",
            label: topBar.about,
            onSelect: () => setHelpDialog("about"),
          },
          { kind: "separator", id: "separator-licenses" },
          {
            kind: "item",
            id: "license",
            label: topBar.license,
            onSelect: () => setHelpDialog("license"),
          },
          {
            kind: "item",
            id: "thirdPartyLicenses",
            label: topBar.thirdPartyLicenses,
            onSelect: () => setHelpDialog("thirdPartyLicenses"),
          },
        ],
      },
    ],
    [
      topBar,
      aiAccessTexts,
      actions,
      viewportPersistence,
      exportActions,
      exportMessages,
      activeDocumentId,
      exportHtml,
      shownTarget,
      busy,
      hasProject,
      themeController,
      themePreference,
      themeLoading,
      languageController,
      languagePreference,
      languageLoading,
      textSizeController,
      textSize,
      textSizeLoading,
      autoSaveController,
      autoSaveEnabled,
      autoSaveLoading,
    ],
  );

  return (
    <header className="top-bar">
      {/* The app and Project names are in the window's own title bar ("Design Dawn (name)");
          this heading is for assistive technology only. */}
      <h1 className="top-bar__app-name">{APP_CONFIG.displayName}</h1>
      <MenuBar label={topBar.menubarLabel} menus={menus} />
      <div className="top-bar__spacer" />
      <Notifications />
      <HelpDialogs dialog={helpDialog} onChange={setHelpDialog} />
      {aiAccessOpen && (
        <AiAccessDialog onClose={() => setAiAccessOpen(false)} />
      )}
      <AiAccessRequestPrompt />
      {printTarget !== null && (
        <PrintDialog
          target={printTarget}
          onClose={() => setPrintTarget(null)}
        />
      )}
    </header>
  );
}
