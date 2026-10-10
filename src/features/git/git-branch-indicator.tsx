import type { GitBranchInfo } from "../../application/ports/git-gateway";
import { useMessages } from "../workspace/use-messages";
import { shortCommitId } from "./git-history-format";
import { BranchIcon } from "./git-icons";

// The branch name is repository text and is rendered as React text only. A detached HEAD
// (no branch name) shows the short commit ID instead.
export function GitBranchIndicator({
  branch,
}: {
  readonly branch: GitBranchInfo | null;
}) {
  const messages = useMessages().git;
  if (branch === null) return null;
  const detached = branch.head === null;
  const name =
    branch.head ?? (branch.oid === null ? "" : shortCommitId(branch.oid));
  const text = detached
    ? [name, messages.detachedSuffix].filter((part) => part !== "").join(" ")
    : name;
  return (
    <span className="git-branch" title={messages.branchLabel(text)}>
      <BranchIcon />
      <span className="git-branch__name">{text}</span>
    </span>
  );
}
