import type { GitBranchInfo } from "../../application/ports/git-gateway";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { requestGitPush } from "./git-action-flow";
import { shortCommitId } from "./git-history-format";
import { BranchIcon, CloudUploadIcon } from "./git-icons";
import { runGitSync } from "./git-remote-flow";
import { useGitBlocked } from "./use-git-blocked";

// The branch name is repository text and is rendered as React text only. A detached HEAD
// (no branch name) shows the short commit ID instead. Next to it: the commits to pull /
// push as a Sync button, or - without an upstream - a Publish button.
export function GitBranchIndicator({
  branch,
}: {
  readonly branch: GitBranchInfo | null;
}) {
  const messages = useMessages().git;
  const services = useWorkspaceServices();
  const blocked = useGitBlocked();
  if (branch === null) return null;
  const detached = branch.head === null;
  const name =
    branch.head ?? (branch.oid === null ? "" : shortCommitId(branch.oid));
  const text = detached
    ? [name, messages.detachedSuffix].filter((part) => part !== "").join(" ")
    : name;
  const behind = branch.behind ?? 0;
  const ahead = branch.ahead ?? 0;
  const counts = [
    behind > 0 ? messages.behindCount(behind) : null,
    ahead > 0 ? messages.aheadCount(ahead) : null,
  ]
    .filter((part) => part !== null)
    .join(" ");
  return (
    <>
      <span className="git-branch" title={messages.branchLabel(text)}>
        <BranchIcon />
        <span className="git-branch__name">{text}</span>
      </span>
      {!detached && branch.upstream !== null && counts !== "" ? (
        <button
          type="button"
          className="git-branch__sync"
          disabled={blocked}
          title={messages.syncChanges}
          aria-label={messages.syncCountsLabel(behind, ahead)}
          onClick={() => void runGitSync(services)}
        >
          {counts}
        </button>
      ) : null}
      {!detached && branch.upstream === null && branch.oid !== null ? (
        <button
          type="button"
          className="git-icon-button"
          disabled={blocked}
          title={messages.publishBranch}
          aria-label={messages.publishBranch}
          onClick={() => void requestGitPush(services)}
        >
          <CloudUploadIcon />
        </button>
      ) : null}
    </>
  );
}
