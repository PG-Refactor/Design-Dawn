// Composition root: the only place that wires the real infrastructure to the application
// layer. No React here; `main.tsx` hands the returned services to the UI.

import { createInMemoryClipboard } from "../application/clipboard/clipboard";
import type { ExternalChangeController } from "../application/external-change/external-change-controller";
import {
  createGitController,
  type GitController,
} from "../application/git/git-controller";
import {
  createProjectWriteSignal,
  type ProjectWriteSignal,
  withWriteSignal,
} from "../application/git/project-write-signal";
import { createDefaultIdGenerator } from "../application/id-generator";
import {
  createLanguageController,
  type LanguageController,
} from "../application/language/language-controller";
import type { LoadIssueRepairController } from "../application/load-issue-repair/load-issue-repair-controller";
import type { AppRequestSource } from "../application/ports/app-request-source";
import type { AssetUrlResolver } from "../application/ports/asset-url-resolver";
import type { DropEventSource } from "../application/ports/drop-event-source";
import type { Scheduler } from "../application/ports/scheduler";
import type { CloseRequestSource } from "../application/ports/window-close";
import {
  type AutoSaveController,
  createAutoSaveController,
} from "../application/settings/auto-save-controller";
import {
  createLayoutSettingsController,
  type LayoutSettingsController,
} from "../application/settings/layout-settings-controller";
import {
  createTextSizeController,
  type TextSizeController,
} from "../application/settings/text-size-controller";
import {
  type ApplicationStore,
  createApplicationStore,
} from "../application/state/application-state";
import {
  createThemeController,
  type ThemeController,
} from "../application/theme/theme-controller";
import {
  createWorkspace,
  type Workspace,
} from "../application/workspace/workspace";
import { LAYOUT_CONFIG } from "../config/layout-config";
import {
  AUTO_SAVE_DELAY_MS,
  DEFAULT_AUTO_SAVE_ENABLED,
  UNDO_HISTORY_LIMIT,
} from "../config/session-config";
import {
  type CanvasActions,
  createCanvasActions,
} from "../features/canvas/canvas-actions";
import {
  createViewportPersistence,
  type ViewportPersistence,
} from "../features/canvas/viewport-persistence";
import { createAppExternalChangeController } from "../features/external-change/create-external-change-controller";
import { createAppLoadIssueRepairController } from "../features/load-issue-repair/create-load-issue-repair-controller";
import {
  createDraftRegistry,
  type DraftRegistry,
} from "../features/workspace/draft-registry";
import { addOperationError } from "../features/workspace/ui-state/shell-ui-state";
import {
  createUiStateStore,
  type UiStateStore,
} from "../features/workspace/ui-state/ui-state";
import { connectWorkspaceToUiState } from "../features/workspace/ui-state/workspace-ui-connector";
import {
  createWorkspaceActions,
  type WorkspaceActions,
} from "../features/workspace/workspace-actions";
import { createMatchMediaOsThemeSource } from "../infrastructure/browser/match-media-os-theme-source";
import { createNavigatorSystemLanguageSource } from "../infrastructure/browser/navigator-system-language-source";
import { createTauriAppRequestSource } from "../infrastructure/tauri/tauri-app-request-source";
import { createTauriAppSettingsGateway } from "../infrastructure/tauri/tauri-app-settings-gateway";
import { createTauriAssetUrlResolver } from "../infrastructure/tauri/tauri-asset-url-resolver";
import { createTauriCloseRequestSource } from "../infrastructure/tauri/tauri-close-request-source";
import { createTauriDropEventSource } from "../infrastructure/tauri/tauri-drop-event-source";
import { createTauriGitGateway } from "../infrastructure/tauri/tauri-git-gateway";
import { createTauriPersistenceGateway } from "../infrastructure/tauri/tauri-persistence-gateway";
import { createTauriViewportGateway } from "../infrastructure/tauri/tauri-viewport-gateway";
import { createTimeoutScheduler } from "../infrastructure/timer/timeout-scheduler";

export interface AppServices {
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
  readonly workspace: Workspace;
  // What the UI calls; the only path from components to the workspace.
  readonly actions: WorkspaceActions;
  // What the canvas calls to change documents (one gesture = one application command).
  readonly canvasActions: CanvasActions;
  // Uncommitted editor drafts; `actions.saveAll` commits them before saving.
  readonly draftRegistry: DraftRegistry;
  // Files dropped on the window, and the URLs of image assets, for the image blocks.
  readonly dropEventSource: DropEventSource;
  readonly assetUrlResolver: AssetUrlResolver;
  // "The user asked to close the window"; the UI saves, then confirms.
  readonly closeRequestSource: CloseRequestSource;
  // Requests Rust sends to this window while it runs (open a Document of its Project).
  readonly appRequestSource: AppRequestSource;
  // Restores / saves the per-sheet viewport; watches the UI state on its own.
  readonly viewportPersistence: ViewportPersistence;
  // App-level theme state; independent of the workspace, sessions and undo history.
  readonly themeController: ThemeController;
  // The display language app setting (preference and the language it resolves to).
  readonly languageController: LanguageController;
  // The auto-save on/off app setting; also the policy the document sessions follow.
  readonly autoSaveController: AutoSaveController;
  // The Project Tree width app setting (the splitter between the tree and the documents).
  readonly layoutSettingsController: LayoutSettingsController;
  // The UI text size app setting.
  readonly textSizeController: TextSizeController;
  // The open Project's Git state (runtime only; refreshed when a Project is installed).
  // No UI shows it yet.
  readonly gitController: GitController;
  // Told after every write of Project files; the Git panel refreshes itself from it.
  readonly projectWriteSignal: ProjectWriteSignal;
  readonly gitRefreshScheduler: Scheduler;
  // Files changed outside the app: decides between reading again and asking the user.
  readonly externalChangeController: ExternalChangeController;
  // Confirming and running repairs of Load Issues, re-reads and "update all now".
  readonly loadIssueRepairController: LoadIssueRepairController;
  // Detaches the workspace -> UI state connector.
  readonly disconnectUiState: () => void;
}

export function createAppServices(): AppServices {
  const applicationStore = createApplicationStore();
  const uiStateStore = createUiStateStore();
  const idGenerator = createDefaultIdGenerator();
  const projectWriteSignal = createProjectWriteSignal();
  const gateway = withWriteSignal(
    createTauriPersistenceGateway(),
    projectWriteSignal,
  );
  const settingsGateway = createTauriAppSettingsGateway();
  const autoSaveController = createAutoSaveController({
    gateway: settingsGateway,
    defaultEnabled: DEFAULT_AUTO_SAVE_ENABLED,
  });
  const layoutSettingsController = createLayoutSettingsController({
    gateway: settingsGateway,
    defaultProjectTreeWidth: LAYOUT_CONFIG.projectTree.defaultWidthPx,
  });
  const workspace = createWorkspace({
    gateway,
    autoSavePolicy: autoSaveController,
    scheduler: createTimeoutScheduler(),
    idGenerator,
    store: applicationStore,
    config: {
      undoHistoryLimit: UNDO_HISTORY_LIMIT,
      autoSaveDelayMs: AUTO_SAVE_DELAY_MS,
    },
  });
  const draftRegistry = createDraftRegistry();
  const actions = createWorkspaceActions({
    workspace,
    applicationStore,
    uiStateStore,
    draftRegistry,
    autoSavePolicy: autoSaveController,
  });
  const canvasActions = createCanvasActions({
    workspace,
    applicationStore,
    uiStateStore,
    idGenerator,
    gateway,
    // One clipboard for the whole app: copy in one sheet or document, paste in another.
    clipboard: createInMemoryClipboard(),
  });
  const viewportPersistence = createViewportPersistence({
    gateway: createTauriViewportGateway(),
    scheduler: createTimeoutScheduler(),
    applicationStore,
    uiStateStore,
  });
  const gitController = createGitController({
    gateway: createTauriGitGateway(),
    applicationStore,
    reportFailure: (operation, error) =>
      uiStateStore.setState((state) =>
        addOperationError(state, operation, null, error),
      ),
  });
  const externalChangeController = createAppExternalChangeController({
    gateway,
    workspace,
    applicationStore,
    uiStateStore,
    actions,
    draftRegistry,
  });
  const loadIssueRepairController = createAppLoadIssueRepairController({
    gateway,
    applicationStore,
    uiStateStore,
    actions,
    draftRegistry,
  });
  const disconnectUiState = connectWorkspaceToUiState(workspace, uiStateStore);
  const themeController = createThemeController({
    gateway: settingsGateway,
    osThemeSource: createMatchMediaOsThemeSource(
      // Absent outside a webview (for example in node tests).
      typeof globalThis.matchMedia === "function"
        ? globalThis.matchMedia.bind(globalThis)
        : undefined,
    ),
  });
  const languageController = createLanguageController({
    gateway: settingsGateway,
    systemLanguageSource: createNavigatorSystemLanguageSource(
      // Absent outside a webview (for example in node tests).
      typeof globalThis.navigator === "undefined"
        ? undefined
        : globalThis.navigator,
    ),
  });
  const textSizeController = createTextSizeController({
    gateway: settingsGateway,
  });
  return {
    applicationStore,
    uiStateStore,
    workspace,
    actions,
    canvasActions,
    draftRegistry,
    dropEventSource: createTauriDropEventSource(),
    assetUrlResolver: createTauriAssetUrlResolver(),
    closeRequestSource: createTauriCloseRequestSource(),
    appRequestSource: createTauriAppRequestSource(),
    viewportPersistence,
    themeController,
    languageController,
    autoSaveController,
    layoutSettingsController,
    textSizeController,
    gitController,
    projectWriteSignal,
    gitRefreshScheduler: createTimeoutScheduler(),
    externalChangeController,
    loadIssueRepairController,
    disconnectUiState,
  };
}
