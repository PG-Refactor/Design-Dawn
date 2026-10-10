// Refreshing what the Git panel shows: the status, the open diff that follows it and the
// history if it is expanded. Each part is independent, so a failed status read does not
// mark the others failed. Shared by the refresh button and the commit form.

import type { WorkspaceServices } from "../workspace/workspace-services-context";
import {
  type GitDiffServices,
  refreshDiffAfterStatusChange,
} from "./git-diff-session";

export type GitViewServices = GitDiffServices;

// Reloads the history from its first page (the old cursor is discarded) when the section
// is shown: expanded, and rendered only for a ready repository. The load runs through the
// controller queue; the result does not matter to the caller.
export function reloadHistoryIfShown(
  services: Pick<WorkspaceServices, "gitController" | "uiStateStore">,
): void {
  const expanded = services.uiStateStore.getState().gitHistoryExpanded;
  const status = services.gitController.store.getState().status;
  if (expanded && status !== null && status.repositoryState === "ready") {
    void services.gitController.loadHistory();
  }
}

export async function refreshGitView(services: GitViewServices): Promise<void> {
  await services.gitController.refreshGitStatus();
  refreshDiffAfterStatusChange(services);
  reloadHistoryIfShown(services);
}
