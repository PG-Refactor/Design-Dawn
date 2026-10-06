import { createContext, type ReactNode, useContext } from "react";
import type { AssetUrlResolver } from "../../application/ports/asset-url-resolver";
import type { DropEventSource } from "../../application/ports/drop-event-source";
import type { CloseRequestSource } from "../../application/ports/window-close";
import type { LayoutSettingsController } from "../../application/settings/layout-settings-controller";
import type { ApplicationStore } from "../../application/state/application-state";
import type { ThemeState } from "../../application/theme/theme-controller";
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
  // Only `flush` is used: written before the window closes.
  readonly viewportPersistence: Pick<ViewportPersistence, "flush">;
  // The `src` of an image block's `<img>`.
  readonly assetUrlResolver: AssetUrlResolver;
  readonly themeController: ThemeSettingsController & {
    readonly store: Store<ThemeState>;
  };
  readonly autoSaveController: AutoSaveSettingsController;
  readonly layoutSettingsController: Pick<
    LayoutSettingsController,
    "store" | "setProjectTreeWidth"
  >;
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
