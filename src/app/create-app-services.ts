// Composition root: the only place that wires the real infrastructure to the application
// layer. No React here; components receive the returned services later.

import { createDefaultIdGenerator } from "../application/id-generator";
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
  createUiStateStore,
  type UiStateStore,
} from "../features/workspace/ui-state/ui-state";
import { connectWorkspaceToUiState } from "../features/workspace/ui-state/workspace-ui-connector";
import { createMatchMediaOsThemeSource } from "../infrastructure/browser/match-media-os-theme-source";
import { createTauriAppSettingsGateway } from "../infrastructure/tauri/tauri-app-settings-gateway";
import { createTauriPersistenceGateway } from "../infrastructure/tauri/tauri-persistence-gateway";
import { createTimeoutScheduler } from "../infrastructure/timer/timeout-scheduler";

export interface AppServices {
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
  readonly workspace: Workspace;
  // App-level theme state; independent of the workspace, sessions and undo history.
  readonly themeController: ThemeController;
  // Detaches the workspace -> UI state connector.
  readonly disconnectUiState: () => void;
}

export function createAppServices(): AppServices {
  const applicationStore = createApplicationStore();
  const uiStateStore = createUiStateStore();
  const workspace = createWorkspace({
    gateway: createTauriPersistenceGateway(),
    scheduler: createTimeoutScheduler(),
    idGenerator: createDefaultIdGenerator(),
    store: applicationStore,
    config: {
      undoHistoryLimit: UNDO_HISTORY_LIMIT,
      autoSaveDelayMs: AUTO_SAVE_DELAY_MS,
    },
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
    themeController,
    disconnectUiState,
  };
}
