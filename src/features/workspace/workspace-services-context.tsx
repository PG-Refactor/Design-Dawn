import { createContext, type ReactNode, useContext } from "react";
import type { ExternalChangeController } from "../../application/external-change/external-change-controller";
import type { GitController } from "../../application/git/git-controller";
import type { ProjectWriteSignal } from "../../application/git/project-write-signal";
import type { LanguageController } from "../../application/language/language-controller";
import type { LoadIssueRepairController } from "../../application/load-issue-repair/load-issue-repair-controller";
import type { AppRequestSource } from "../../application/ports/app-request-source";
import type { AssetUrlResolver } from "../../application/ports/asset-url-resolver";
import type { DropEventSource } from "../../application/ports/drop-event-source";
import type { Scheduler } from "../../application/ports/scheduler";
import type { CloseRequestSource } from "../../application/ports/window-close";
import type { AutoSaveController } from "../../application/settings/auto-save-controller";
import type { LayoutSettingsController } from "../../application/settings/layout-settings-controller";
import type { ApplicationStore } from "../../application/state/application-state";
import type {
  ThemeController,
  ThemeState,
} from "../../application/theme/theme-controller";
import type { Store } from "../../shared/store/store";
import type { CanvasActions } from "../canvas/canvas-actions";
import type { ViewportPersistence } from "../canvas/viewport-persistence";
import type { AutoSaveSettingsController } from "../settings/auto-save-settings";
import type { ThemeSettingsController } from "../theme/theme-settings";
import type { DraftRegistry } from "./draft-registry";
import type { UiStateStore } from "./ui-state/ui-state";
import type { WorkspaceActions } from "./workspace-actions";

// What the workspace UI needs, handed in by the composition root (no globals). The theme
// controller is only used for the settings control and for showing its errors.
export interface WorkspaceServices {
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
  readonly actions: WorkspaceActions;
  readonly canvasActions: CanvasActions;
  // Markdown editors register their uncommitted drafts here (see `saveAll`).
  readonly draftRegistry: DraftRegistry;
  // Files dropped on the window (Rust reports ids and counts only).
  readonly dropEventSource: DropEventSource;
  // Window close requests (Rust stops the close and asks the Frontend to save first).
  readonly closeRequestSource: CloseRequestSource;
  // Requests Rust sends to this window while it runs (open a Document of its Project).
  readonly appRequestSource: AppRequestSource;
  // Only `flush` is used: written before the window closes.
  readonly viewportPersistence: Pick<ViewportPersistence, "flush">;
  // The `src` of an image block's `<img>`.
  readonly assetUrlResolver: AssetUrlResolver;
  // `applyExternal`: settings another window changed (see `createSettingsChangeHandler`).
  readonly themeController: ThemeSettingsController &
    Pick<ThemeController, "applyExternal"> & {
      readonly store: Store<ThemeState>;
    };
  // `applyExternal` as for the theme; the UI texts follow `store` (see `useMessages`).
  readonly languageController: Pick<
    LanguageController,
    "store" | "setPreference" | "applyExternal"
  >;
  readonly autoSaveController: AutoSaveSettingsController &
    Pick<AutoSaveController, "applyExternal">;
  readonly layoutSettingsController: Pick<
    LayoutSettingsController,
    "store" | "setProjectTreeWidth"
  >;
  // The Git state of the open Project and the operations on it; the UI never calls the Git
  // commands directly.
  readonly gitController: GitController;
  // Told when the app wrote Project files, and the clock that debounces the status read
  // it triggers (see `useGitAutoRefresh`).
  readonly projectWriteSignal: ProjectWriteSignal;
  readonly gitRefreshScheduler: Scheduler;
  // Files changed outside the app; the UI shows its state and
  // forwards the user's choices.
  readonly externalChangeController: ExternalChangeController;
  // Confirming and running the repair of a Load Issue, reading files again, and "update all
  // now" for older file formats.
  readonly loadIssueRepairController: LoadIssueRepairController;
}

const WorkspaceServicesContext = createContext<WorkspaceServices | null>(null);

export function WorkspaceServicesProvider({
  services,
  children,
}: {
  readonly services: WorkspaceServices;
  readonly children: ReactNode;
}) {
  return (
    <WorkspaceServicesContext.Provider value={services}>
      {children}
    </WorkspaceServicesContext.Provider>
  );
}

export function useWorkspaceServices(): WorkspaceServices {
  const services = useContext(WorkspaceServicesContext);
  if (services === null) {
    throw new Error(
      "useWorkspaceServices must be used inside WorkspaceServicesProvider",
    );
  }
  return services;
}
