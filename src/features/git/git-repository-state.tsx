import type { GitStatus } from "../../application/ports/git-gateway";
import type { OperationErrorKind } from "../../application/ports/operation-error";
import { useMessages } from "../workspace/use-messages";
import { useGitState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { GitChangeList } from "./git-change-list";
import { GitCommitBox } from "./git-commit-box";
import { GitHistorySection } from "./git-history-section";
import { refreshGitView } from "./git-view-refresh";

// What the panel knows, decided from the Git state only.
type RepositoryView =
  | { readonly kind: "noProject" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "status"; readonly status: GitStatus };

function viewOf(
  projectId: string | null,
  status: GitStatus | null,
  statusError: OperationErrorKind | null,
): RepositoryView {
  if (projectId === null) return { kind: "noProject" };
  if (status !== null) return { kind: "status", status };
  return statusError === null ? { kind: "loading" } : { kind: "failed" };
}

// The repository state as text. No Git state is shown without an open Project, and a
// stale status is never shown (the controller drops it on failure).
export function GitRepositoryState() {
  const messages = useMessages().git;
  const services = useWorkspaceServices();
  const projectId = useGitState((git) => git.projectId);
  const status = useGitState((git) => git.status);
  const statusError = useGitState((git) => git.statusError);
  const refreshing = useGitState((git) => git.refreshing);
  const runningOperation = useGitState((git) => git.runningOperation);
  const view = viewOf(projectId, status, statusError);

  switch (view.kind) {
    case "noProject":
      return <p className="git-panel__message">{messages.noProject}</p>;
    case "loading":
      return (
        <p role="status" aria-busy="true" className="git-panel__message">
          {messages.loading}
        </p>
      );
    case "failed":
      // The failure itself is already reported by the application layer.
      return (
        <div className="git-panel__message">
          <p role="status">{messages.statusFailed}</p>
          <button
            type="button"
            className="button"
            disabled={refreshing}
            // Same flow as the refresh button, so an expanded history follows the
            // recovered status too.
            onClick={() => void refreshGitView(services)}
          >
            {messages.retry}
          </button>
        </div>
      );
    case "status":
      return (
        <div className="git-panel__state">
          {refreshing ? (
            <p role="status" className="git-panel__refreshing">
              {messages.refreshing}
            </p>
          ) : runningOperation !== null ? (
            // Same place and live region as "refreshing": what the Git action is doing.
            <p role="status" className="git-panel__refreshing">
              {messages.runningOperation[runningOperation]}
            </p>
          ) : null}
          <p
            role="status"
            aria-label={messages.repositoryStateLabel}
            className="git-panel__message"
          >
            {messages.repositoryStates[view.status.repositoryState]}
          </p>
          {view.status.repositoryState === "ready" ? (
            <div className="git-panel__changes">
              <GitCommitBox status={view.status} />
              <GitChangeList status={view.status} />
              <GitHistorySection />
            </div>
          ) : null}
        </div>
      );
  }
}
