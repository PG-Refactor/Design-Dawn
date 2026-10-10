import { useId } from "react";
import { setGitHistoryExpanded } from "../workspace/ui-state/shell-ui-state";
import { useMessages } from "../workspace/use-messages";
import { useGitState, useUiState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { GitHistoryEntryRow } from "./git-history-entry";

// The collapsible commit history of a ready repository. It reads the Git controller's
// history and starts loads; collapsing neither clears it nor cancels a load in flight.
export function GitHistorySection() {
  const messages = useMessages().git;
  const { gitController, uiStateStore } = useWorkspaceServices();
  const expanded = useUiState((ui) => ui.gitHistoryExpanded);
  const history = useGitState((git) => git.history);
  const historyError = useGitState((git) => git.historyError);
  const regionId = useId();

  function toggle(): void {
    const next = !expanded;
    uiStateStore.setState((state) => setGitHistoryExpanded(state, next));
    // A loaded history is not loaded again; a failed first load is retried.
    if (next && history === null) void gitController.loadHistory();
  }

  const firstLoadFailed = history === null && historyError !== null;
  const loadingFirst =
    history !== null &&
    history.status === "loading" &&
    history.entries.length === 0;
  const loadingMore =
    history !== null &&
    history.status === "loading" &&
    history.entries.length > 0;

  return (
    <section className="git-history">
      <h2 className="git-history__heading">
        <button
          type="button"
          className="git-history__toggle"
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={toggle}
        >
          {messages.historyToggle}
        </button>
      </h2>
      <div id={regionId} hidden={!expanded} className="git-history__body">
        {expanded ? (
          <>
            {loadingFirst ? (
              <p role="status" aria-busy="true" className="git-history__note">
                {messages.historyLoading}
              </p>
            ) : null}
            {firstLoadFailed ? (
              <div className="git-history__note">
                <p role="status">{messages.historyFailed}</p>
                <button
                  type="button"
                  className="button"
                  onClick={() => void gitController.loadHistory()}
                >
                  {messages.retry}
                </button>
              </div>
            ) : null}
            {history !== null &&
            history.status === "loaded" &&
            history.entries.length === 0 ? (
              <p className="git-history__note">{messages.historyEmpty}</p>
            ) : null}
            {history !== null && history.entries.length > 0 ? (
              <ol
                className="git-history__list"
                aria-label={messages.historyListLabel}
              >
                {history.entries.map((entry) => (
                  <GitHistoryEntryRow key={entry.commitId} entry={entry} />
                ))}
              </ol>
            ) : null}
            {history !== null &&
            history.entries.length > 0 &&
            historyError !== null ? (
              <p role="status" className="git-history__note">
                {messages.historyMoreFailed}
              </p>
            ) : null}
            {history !== null && history.nextCursor !== null ? (
              <button
                type="button"
                className="button"
                disabled={loadingMore}
                onClick={() => void gitController.loadMoreHistory()}
              >
                {loadingMore
                  ? messages.historyLoadingMore
                  : messages.historyLoadMore}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
