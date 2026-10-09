// Opening, switching, closing and refreshing the diff: the selection (UI state) and the
// diff load (Git controller) always change together, so they change here. The controller
// already drops superseded answers and the Project change clears the selection.

import { setGitSelection } from "../workspace/ui-state/shell-ui-state";
import type { GitSelection } from "../workspace/ui-state/ui-state";
import type { WorkspaceServices } from "../workspace/workspace-services-context";
import { nextDiffAction } from "./next-diff-action";

export type GitDiffServices = Pick<
  WorkspaceServices,
  "gitController" | "uiStateStore"
>;

// Selects the file side and loads its diff. Selecting the same one again loads it again.
export function openDiff(
  services: GitDiffServices,
  selection: GitSelection,
): void {
  services.uiStateStore.setState((state) => setGitSelection(state, selection));
  void services.gitController.loadDiff(selection.path, selection.side);
}

export function closeDiff(services: GitDiffServices): void {
  services.gitController.clearDiff();
  services.uiStateStore.setState((state) => setGitSelection(state, null));
}

// To call once the status has changed (after Stage / Unstage, later Commit have settled):
// reads the latest selection and status and applies `nextDiffAction`.
export function refreshDiffAfterStatusChange(services: GitDiffServices): void {
  const selection = services.uiStateStore.getState().gitSelection;
  const status = services.gitController.store.getState().status;
  const action = nextDiffAction(selection, status);
  switch (action.kind) {
    case "none":
      return;
    case "reload":
      if (selection !== null) openDiff(services, selection);
      return;
    case "switch":
      openDiff(services, action.selection);
      return;
    case "close":
      closeDiff(services);
      return;
  }
}
