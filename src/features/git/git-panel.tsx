import { useRef } from "react";
import { useMessages } from "../workspace/use-messages";
import { useGitState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { GitBranchIndicator } from "./git-branch-indicator";
import { RefreshIcon } from "./git-icons";
import { GitMoreActionsMenu } from "./git-more-actions-menu";
import { GitRepositoryState } from "./git-repository-state";
import { refreshGitView } from "./git-view-refresh";
import "./git-panel.css";

// The Git side of the sidebar. It only reads the Git controller's state and calls its
// operations; it keeps no Git state of its own.
export function GitPanel() {
  const messages = useMessages().git;
  const services = useWorkspaceServices();
  // A second click before the first refresh settled would start a second status read
  // (and a second history load).
  const refreshInFlight = useRef(false);
  const hasProject = useGitState((git) => git.projectId !== null);
  const refreshing = useGitState((git) => git.refreshing);
  const operating = useGitState((git) => git.operating);
  const status = useGitState((git) => git.status);
  const branch = status?.branch ?? null;

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
    <section className="git-panel" aria-label={messages.panelLabel}>
      {hasProject ? (
        <header className="git-panel__header">
          <h2 className="git-panel__title">{messages.panelTitle}</h2>
          <GitBranchIndicator branch={branch} />
          <button
            type="button"
            className="git-icon-button git-panel__refresh"
            disabled={refreshing || operating}
            aria-label={messages.refresh}
            title={messages.refresh}
            // Status first, then the open diff follows it (reload / switch / close) and an
            // expanded history is reloaded from its first page.
            onClick={() => void refresh()}
          >
            <RefreshIcon />
          </button>
          {status?.repositoryState === "ready" ? (
            <GitMoreActionsMenu status={status} />
          ) : null}
        </header>
      ) : null}
      <GitRepositoryState />
    </section>
  );
}
