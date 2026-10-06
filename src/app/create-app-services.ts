// Composition root: the only place that wires the real infrastructure to the application
// layer. No React here; `main.tsx` hands the returned services to the UI.

import { createInMemoryClipboard } from "../application/clipboard/clipboard";
import { createDefaultIdGenerator } from "../application/id-generator";
import type { AssetUrlResolver } from "../application/ports/asset-url-resolver";
import type { DropEventSource } from "../application/ports/drop-event-source";
import type { CloseRequestSource } from "../application/ports/window-close";
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
import {
  AUTO_SAVE_DELAY_MS,
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
import {
  createDraftRegistry,
  type DraftRegistry,
} from "../features/workspace/draft-registry";
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
import { createTauriAppSettingsGateway } from "../infrastructure/tauri/tauri-app-settings-gateway";
import { createTauriAssetUrlResolver } from "../infrastructure/tauri/tauri-asset-url-resolver";
import { createTauriCloseRequestSource } from "../infrastructure/tauri/tauri-close-request-source";
import { createTauriDropEventSource } from "../infrastructure/tauri/tauri-drop-event-source";
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
  // Restores / saves the per-sheet viewport; watches the UI state on its own.
  readonly viewportPersistence: ViewportPersistence;
  // App-level theme state; independent of the workspace, sessions and undo history.
  readonly themeController: ThemeController;
  // Detaches the workspace -> UI state connector.
  readonly disconnectUiState: () => void;
}

export function createAppServices(): AppServices {
  const applicationStore = createApplicationStore();
  const uiStateStore = createUiStateStore();
  const idGenerator = createDefaultIdGenerator();
  const gateway = createTauriPersistenceGateway();
  const workspace = createWorkspace({
    gateway,
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
  const disconnectUiState = connectWorkspaceToUiState(workspace, uiStateStore);
  const themeController = createThemeController({
    gateway: createTauriAppSettingsGateway(),
    osThemeSource: createMatchMediaOsThemeSource(
      // Absent outside a webview (for example in node tests).
      typeof globalThis.matchMedia === "function"
        ? globalThis.matchMedia.bind(globalThis)
        : undefined,
    ),
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
    viewportPersistence,
    themeController,
    disconnectUiState,
  };
}
