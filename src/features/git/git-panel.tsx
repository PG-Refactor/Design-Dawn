import { useRef } from "react";
import { useGitState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { GIT_MESSAGES } from "./git-messages";
import { GitRepositoryState } from "./git-repository-state";
import { refreshGitView } from "./git-view-refresh";
import "./git-panel.css";

// The Git side of the sidebar. It only reads the Git controller's state and calls its
// operations; it keeps no Git state of its own.
export function GitPanel() {
  const services = useWorkspaceServices();
  // A second click before the first refresh settled would start a second status read
  // (and a second history load).
  const refreshInFlight = useRef(false);
  const hasProject = useGitState((git) => git.projectId !== null);
  const refreshing = useGitState((git) => git.refreshing);
  const operating = useGitState((git) => git.operating);

  async function refresh(): Promise<void> {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      await refreshGitView(services);
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
            // Status first, then the open diff follows it (reload / switch / close) and an
            // expanded history is reloaded from its first page (docs/ui-design.md §13.3).
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
