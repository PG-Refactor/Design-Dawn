import { useRef } from "react";
import { useGitState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { refreshDiffAfterStatusChange } from "./git-diff-session";
import { GIT_MESSAGES } from "./git-messages";
import { GitRepositoryState } from "./git-repository-state";
import "./git-panel.css";

// The Git side of the sidebar. It only reads the Git controller's state and calls its
// operations; it keeps no Git state of its own.
export function GitPanel() {
  const services = useWorkspaceServices();
  const { gitController } = services;
  // A second click before the first refresh settled would start a second status read.
  const refreshInFlight = useRef(false);
  const hasProject = useGitState((git) => git.projectId !== null);
  const refreshing = useGitState((git) => git.refreshing);
  const operating = useGitState((git) => git.operating);

  async function refresh(): Promise<void> {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      await gitController.refreshGitStatus();
      refreshDiffAfterStatusChange(services);
    } finally {
      refreshInFlight.current = false;
    }
  }

  return (
    <section className="git-panel" aria-label={GIT_MESSAGES.panelLabel}>
      {hasProject ? (
        <header className="git-panel__header">
          <button
            type="button"
            className="button"
            disabled={refreshing || operating}
            // Status first, then the open diff follows it (reload / switch / close); the
            // history is refreshed here too once that part exists (docs/ui-design.md §13.3).
            onClick={() => void refresh()}
          >
            {GIT_MESSAGES.refresh}
          </button>
        </header>
      ) : null}
      <GitRepositoryState />
    </section>
  );
}
