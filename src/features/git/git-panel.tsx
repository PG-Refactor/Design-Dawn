import { useGitState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { GIT_MESSAGES } from "./git-messages";
import { GitRepositoryState } from "./git-repository-state";
import "./git-panel.css";

// The Git side of the sidebar. It only reads the Git controller's state and calls its
// operations; it keeps no Git state of its own.
export function GitPanel() {
  const { gitController } = useWorkspaceServices();
  const hasProject = useGitState((git) => git.projectId !== null);
  const refreshing = useGitState((git) => git.refreshing);
  const operating = useGitState((git) => git.operating);

  return (
    <section className="git-panel" aria-label={GIT_MESSAGES.panelLabel}>
      {hasProject ? (
        <header className="git-panel__header">
          <button
            type="button"
            className="button"
            disabled={refreshing || operating}
            // Refreshes the status only; the open diff and the history are refreshed here
            // too once those parts exist (docs/ui-design.md §13.3).
            onClick={() => void gitController.refreshGitStatus()}
          >
            {GIT_MESSAGES.refresh}
          </button>
        </header>
      ) : null}
      <GitRepositoryState />
    </section>
  );
}
