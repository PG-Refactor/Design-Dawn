import type { GitStatus } from "../../application/ports/git-gateway";
import { PopupMenu } from "../../shared/menu/popup-menu";
import { useMessages } from "../workspace/use-messages";
import { useUiState } from "../workspace/workspace-hooks";
import { EllipsisIcon } from "./git-icons";
import { headerMenuEntries } from "./git-menu-items";
import { useGitBlocked } from "./use-git-blocked";
import { useGitMenuRunner } from "./use-git-menu-runner";

// The "…" menu of the panel header: remote operations, Undo Last Commit and the commit
// actions.
export function GitMoreActionsMenu({ status }: { readonly status: GitStatus }) {
  const messages = useMessages().git;
  const message = useUiState((ui) => ui.gitCommitMessage);
  const blocked = useGitBlocked();
  const runner = useGitMenuRunner();
  return (
    <PopupMenu
      className="git-more-actions"
      triggerLabel={messages.moreActions}
      triggerContent={<EllipsisIcon />}
      menuLabel={messages.moreActions}
      items={headerMenuEntries({ messages, status, message, blocked, runner })}
    />
  );
}
