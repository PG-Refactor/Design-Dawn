import { useState } from "react";
import type { GitUnfinishedOperation } from "../../application/ports/git-gateway";
import { ConfirmDialog } from "../workspace/confirm-dialog";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { runAbortMerge } from "./git-remote-flow";
import { useGitBlocked } from "./use-git-blocked";

// What git left unfinished, at the top of the Git tab: without it, a merge whose conflicts
// are all resolved looks like ordinary staged changes. Only a merge can be aborted here;
// the others are pointed to git itself.
export function GitUnfinishedBanner({
  operation,
}: {
  readonly operation: GitUnfinishedOperation;
}) {
  const messages = useMessages();
  const texts = messages.git;
  const services = useWorkspaceServices();
  const blocked = useGitBlocked();
  const [asking, setAsking] = useState(false);
  return (
    <div className="git-unfinished" role="status">
      <p className="git-unfinished__text">{texts.unfinished[operation]}</p>
      {operation === "merge" ? (
        <button
          type="button"
          className="button git-unfinished__action"
          disabled={blocked}
          onClick={() => setAsking(true)}
        >
          {texts.abortMerge}
        </button>
      ) : null}
      {asking ? (
        <ConfirmDialog
          title={texts.abortMergeDialog.title}
          paragraphs={[texts.abortMergeDialog.body]}
          cancelLabel={messages.workspace.dialogs.cancel}
          confirmLabel={texts.abortMergeDialog.confirm}
          busy={blocked}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            void runAbortMerge(services);
          }}
        />
      ) : null}
    </div>
  );
}
