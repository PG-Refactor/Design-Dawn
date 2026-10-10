import type { GitStatus } from "../../application/ports/git-gateway";
import type { GitSelection } from "../workspace/ui-state/ui-state";
import { useMessages } from "../workspace/use-messages";
import { useGitState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { changeSidesOf } from "./git-change-sections";
import { GitDiffContent } from "./git-diff-content";
import { activateDiff } from "./git-diff-session";

interface GitDiffViewProps {
  readonly selection: GitSelection;
  readonly status: GitStatus | null;
}

// The diff of the active diff tab: the path header and the body for what the controller
// holds. Only a diff of exactly the tab's path and side is shown; anything else counts as
// loading. The side and closing belong to the tab strip.
export function GitDiffView({ selection, status }: GitDiffViewProps) {
  const messages = useMessages().git;
  const services = useWorkspaceServices();
  const diff = useGitState((git) => git.diff);

  const stagedEntry =
    status === null ? null : changeSidesOf(status, selection.path).staged;
  const pathText =
    stagedEntry?.originalPath != null && selection.side === "staged"
      ? messages.renamedPathText(stagedEntry.originalPath, selection.path)
      : selection.path;

  function renderBody() {
    if (diff === null) {
      // The controller clears the diff on failure and the failure is already reported.
      return (
        <div className="git-diff__message">
          <p role="status">{messages.diffFailed}</p>
          <button
            type="button"
            className="button"
            onClick={() => activateDiff(services, selection)}
          >
            {messages.retry}
          </button>
        </div>
      );
    }
    if (
      diff.path !== selection.path ||
      diff.side !== selection.side ||
      diff.status === "loading"
    ) {
      return (
        <p role="status" aria-busy="true" className="git-diff__message">
          {messages.diffLoading}
        </p>
      );
    }
    return <GitDiffContent diff={diff.result} />;
  }

  return (
    <div className="git-diff">
      <header className="git-diff__header">
        <h2 className="git-diff__path">{pathText}</h2>
      </header>
      <div className="git-diff__body">{renderBody()}</div>
    </div>
  );
}
