// Commit, Commit & Push / Sync and Undo Last Commit as flows (docs/git-development.md
// §11.16, R-3). The commit form and its menus (R-4) only collect the answers (amend?
// stage everything? then what?) and call these.

import { setGitCommitMessage } from "../workspace/ui-state/shell-ui-state";
import type { GitCommitFollowUp } from "../workspace/ui-state/ui-state";
import { deriveGitChangeSections } from "./git-change-sections";
import { refreshDiffAfterStatusChange } from "./git-diff-session";
import {
  type GitFlowOutcome,
  type GitFlowServices,
  runGitPush,
  runGitSync,
} from "./git-remote-flow";
import { reloadHistoryIfShown } from "./git-view-refresh";

export type { GitCommitFollowUp };

export interface GitCommitRequest {
  readonly amend: boolean;
  // Stage everything first (the caller has asked for confirmation).
  readonly stageAll: boolean;
  readonly followUp: GitCommitFollowUp;
  // Needed for `followUp: "push"` on a branch without an upstream (it is published there).
  readonly remote: string | null;
}

type CommitServices = GitFlowServices;

function hasStagedChanges(services: CommitServices): boolean {
  const status = services.gitController.store.getState().status;
  return (
    status !== null &&
    deriveGitChangeSections(status).some((section) => section.id === "staged")
  );
}

// Commits what is staged (or everything with `stageAll`), never saving the workspace and
// never touching Documents. The message is the draft; an Amend with a blank draft passes
// it blank, which keeps the old message. The follow-up runs only after a made commit.
export async function runGitCommit(
  services: CommitServices,
  request: GitCommitRequest,
): Promise<GitFlowOutcome> {
  const { gitController, uiStateStore } = services;
  const { projectId, status, operating } = gitController.store.getState();
  if (projectId === null || operating) return "skipped";
  if (status === null || status.repositoryState !== "ready") return "skipped";
  // Read from the store, not a closure: it is what the user sees and what is sent.
  const submitted = uiStateStore.getState().gitCommitMessage;
  if (!request.amend) {
    if (submitted.trim() === "") return "skipped";
    if (!request.stageAll && !hasStagedChanges(services)) return "skipped";
  }
  const result = await gitController.commit(submitted, {
    amend: request.amend,
    stageAll: request.stageAll,
  });
  // A failure keeps the draft. A commit that succeeded clears it even when the status
  // could not be read afterwards. The Project may have changed meanwhile: then the draft
  // (reset with the old Project) is not ours to clear.
  const committedHere =
    result.ok && gitController.store.getState().projectId === projectId;
  if (committedHere) {
    uiStateStore.setState((state) =>
      state.gitCommitMessage === submitted
        ? setGitCommitMessage(state, "")
        : state,
    );
  }
  refreshDiffAfterStatusChange(services);
  // Only a made commit changes the history; the load never affects this outcome.
  if (committedHere) reloadHistoryIfShown(services);
  if (!result.ok) return "failed";
  if (!committedHere || request.followUp === "none") return "done";
  return request.followUp === "push"
    ? runGitPush(services, request.remote)
    : runGitSync(services);
}

// Takes the last commit back. Its message goes back into the draft, but only into a blank
// one (never over what the user is writing), without the trailing newline git stores.
export async function runUndoLastCommit(
  services: CommitServices,
): Promise<GitFlowOutcome> {
  const { gitController, uiStateStore } = services;
  const projectId = gitController.store.getState().projectId;
  if (projectId === null) return "skipped";
  const result = await gitController.undoLastCommit();
  if (!result.ok) {
    refreshDiffAfterStatusChange(services);
    return "failed";
  }
  const restored = result.value.message?.trimEnd() ?? null;
  const sameProject = gitController.store.getState().projectId === projectId;
  if (restored !== null && sameProject) {
    uiStateStore.setState((state) =>
      state.gitCommitMessage.trim() === ""
        ? setGitCommitMessage(state, restored)
        : state,
    );
  }
  refreshDiffAfterStatusChange(services);
  if (sameProject) reloadHistoryIfShown(services);
  return "done";
}
