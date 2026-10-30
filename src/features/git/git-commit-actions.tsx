import type { ReactNode } from "react";
import type { GitStatus } from "../../application/ports/git-gateway";
import { PopupMenu } from "../../shared/menu/popup-menu";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { requestGitPush } from "./git-action-flow";
import { CheckIcon, ChevronIcon, CloudUploadIcon, SyncIcon } from "./git-icons";
import { branchFactsOf, commitMenuItems } from "./git-menu-items";
import { runGitSync } from "./git-remote-flow";
import { useGitMenuRunner } from "./use-git-menu-runner";

// What the main button of the commit form does (a single primary action button): commit, or -
// when there is nothing at all to commit - synchronize or publish the branch.
export type GitPrimaryAction =
  | { readonly kind: "commit" }
  | { readonly kind: "sync"; readonly behind: number; readonly ahead: number }
  | { readonly kind: "publish" };

export function primaryActionOf(status: GitStatus): GitPrimaryAction {
  const facts = branchFactsOf(status);
  if (status.files.length > 0 || status.branch === null) {
    return { kind: "commit" };
  }
  if (facts.hasUpstream) {
    // Counts git did not give (upstream gone) mean nothing to synchronize.
    const behind = status.branch.behind ?? 0;
    const ahead = status.branch.ahead ?? 0;
    return behind > 0 || ahead > 0
      ? { kind: "sync", behind, ahead }
      : { kind: "commit" };
  }
  return !facts.detached && facts.hasHead
    ? { kind: "publish" }
    : { kind: "commit" };
}

interface GitCommitActionsProps {
  readonly status: GitStatus;
  readonly message: string;
  // Another Git action runs, or the workspace is busy.
  readonly blocked: boolean;
  readonly canCommit: boolean;
  readonly submitting: boolean;
  readonly describedBy: string;
  readonly onCommit: () => void;
}

// The main button and, next to it, the menu of the other commit actions.
export function GitCommitActions({
  status,
  message,
  blocked,
  canCommit,
  submitting,
  describedBy,
  onCommit,
}: GitCommitActionsProps) {
  const messages = useMessages().git;
  const services = useWorkspaceServices();
  const runner = useGitMenuRunner();
  const primary = primaryActionOf(status);
  const items = commitMenuItems({ messages, status, message, blocked, runner });

  let button: ReactNode;
  switch (primary.kind) {
    case "sync":
      button = (
        <button
          type="button"
          className="git-primary-button"
          disabled={blocked}
          aria-label={messages.syncCountsLabel(primary.behind, primary.ahead)}
          onClick={() => void runGitSync(services)}
        >
          <SyncIcon />
          {messages.syncChangesWithCounts(primary.behind, primary.ahead)}
        </button>
      );
      break;
    case "publish":
      button = (
        <button
          type="button"
          className="git-primary-button"
          disabled={blocked}
          onClick={() => void requestGitPush(services)}
        >
          <CloudUploadIcon />
          {messages.publishBranch}
        </button>
      );
      break;
    case "commit":
      button = (
        <button
          type="button"
          className="git-primary-button"
          disabled={!canCommit}
          aria-describedby={describedBy}
          onClick={onCommit}
        >
          <CheckIcon />
          {submitting ? messages.committing : messages.commit}
        </button>
      );
      break;
  }

  return (
    <div className="git-commit-split">
      {button}
      <PopupMenu
        className="git-commit-split__menu"
        triggerLabel={messages.commitMenuLabel}
        triggerContent={<ChevronIcon />}
        menuLabel={messages.commitMenuLabel}
        items={items}
      />
    </div>
  );
}
