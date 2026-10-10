import { useEffect } from "react";
import { AUTO_REFRESH_DELAY_MS } from "../../config/git-config";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { refreshDiffAfterStatusChange } from "./git-diff-session";

// Keeps the Git status current without the refresh button, as VS Code does: after the app
// wrote Project files, and when the window regains focus (edits made in another editor or
// by git itself). Registered once for the shell. Bursts collapse into one read through the
// debounce. The read is silent and the open diff tabs follow it; the history is left alone,
// because saving does not add commits.
export function useGitAutoRefresh(): void {
  const services = useWorkspaceServices();
  const { projectWriteSignal, gitRefreshScheduler } = services;

  useEffect(() => {
    let cancelPending: (() => void) | null = null;

    const refresh = async (): Promise<void> => {
      cancelPending = null;
      if (services.applicationStore.getState().project === null) return;
      await services.gitController.refreshGitStatusInBackground();
      refreshDiffAfterStatusChange(services);
    };
    const request = (): void => {
      cancelPending?.();
      cancelPending = gitRefreshScheduler.schedule(
        AUTO_REFRESH_DELAY_MS,
        () => {
          void refresh();
        },
      );
    };

    const unsubscribe = projectWriteSignal.subscribe(request);
    window.addEventListener("focus", request);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", request);
      cancelPending?.();
    };
  }, [services, projectWriteSignal, gitRefreshScheduler]);
}
