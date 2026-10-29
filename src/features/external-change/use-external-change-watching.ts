import { useEffect } from "react";
import type { ExternalChangeEvent } from "../../application/external-change/external-change-controller";
import { refreshDiffAfterStatusChange } from "../git/git-diff-session";
import {
  addOperationError,
  showNotice,
} from "../workspace/ui-state/shell-ui-state";
import {
  useWorkspaceServices,
  type WorkspaceServices,
} from "../workspace/workspace-services-context";

// What an event of the controller means for the screen (docs/ui-design.md §14).
function applyEvent(
  services: WorkspaceServices,
  event: ExternalChangeEvent,
): void {
  const { uiStateStore } = services;
  switch (event.type) {
    case "reloaded":
      uiStateStore.setState((state) => showNotice(state, "externalReloaded"));
      return;
    case "reloadFailed":
      uiStateStore.setState((state) =>
        addOperationError(state, "reloadExternalChange", null, event.error),
      );
      return;
    case "checkFailed":
      uiStateStore.setState((state) =>
        addOperationError(state, "checkExternalChange", null, event.error),
      );
      return;
    case "watchUnavailable":
      uiStateStore.setState((state) =>
        showNotice(state, "externalWatchUnavailable"),
      );
      return;
    case "projectFilesActivity":
      // Files changed under the Project, so the Git status behind the panel is stale.
      void services.gitController.refreshGitStatusInBackground().then(() => {
        refreshDiffAfterStatusChange(services);
      });
      return;
  }
}

// Connects the controller to what drives it: Rust's change notices, the window regaining
// focus, a Project being installed, and the end of whatever blocked it. Registered once for
// the shell.
export function useExternalChangeWatching(): void {
  const services = useWorkspaceServices();
  useEffect(() => {
    const {
      externalChangeController,
      appRequestSource,
      applicationStore,
      uiStateStore,
    } = services;
    const stopEvents = externalChangeController.subscribeEvents((event) =>
      applyEvent(services, event),
    );
    const stopNotices = appRequestSource.subscribeProjectFiles((notice) => {
      void externalChangeController.handleNotice(notice);
    });
    const check = (): void => {
      void externalChangeController.check();
    };
    window.addEventListener("focus", check);

    // A Project that was just installed (opened or read again): compare once, so a change
    // made before the watcher started, or while the window was elsewhere, is not missed.
    let lastRead: string | null = null;
    const stopApplication = applicationStore.subscribe(() => {
      const project = applicationStore.getState().project;
      const read =
        project === null
          ? null
          : `${project.projectId}:${project.sessionGeneration}`;
      if (read === lastRead) return;
      lastRead = read;
      if (read !== null) check();
    });

    let wasBusy = uiStateStore.getState().busy;
    const stopBusy = uiStateStore.subscribe(() => {
      const busy = uiStateStore.getState().busy;
      if (wasBusy && !busy) void externalChangeController.resume();
      wasBusy = busy;
    });
    return () => {
      stopEvents();
      stopNotices();
      stopApplication();
      stopBusy();
      window.removeEventListener("focus", check);
    };
  }, [services]);
}
