// Opening, activating, closing and refreshing the diff tabs: the tab set (UI state) and the
// diff load (Git controller, which holds ONE diff) always change together, so they change
// here. The controller already drops superseded answers and the Project change clears the
// tabs.

import {
  activateDiffTab,
  activeDiffSelection,
  closeDiffTab,
  isActiveDiffTab,
  openDiffTab,
  pinDiffTab,
  replaceDiffTabs,
} from "../workspace/ui-state/diff-tabs";
import type { GitSelection } from "../workspace/ui-state/ui-state";
import type { WorkspaceServices } from "../workspace/workspace-services-context";
import { retargetDiffTabs } from "./retarget-diff-tabs";

export type GitDiffServices = Pick<
  WorkspaceServices,
  "gitController" | "uiStateStore"
>;

function loadDiffOf(services: GitDiffServices, target: GitSelection): void {
  void services.gitController.loadDiff(target.path, target.side);
}

// Opens the diff in the preview tab (single click / Enter on a row), or activates the tab
// it already has, and loads it. Opening the same one again loads it again.
export function openDiffPreview(
  services: GitDiffServices,
  target: GitSelection,
): void {
  services.uiStateStore.setState((state) => openDiffTab(state, target, false));
  loadDiffOf(services, target);
}

// Opens the diff as a pinned tab (double click on a row), or pins the tab it already has.
export function openDiffPinned(
  services: GitDiffServices,
  target: GitSelection,
): void {
  const alreadyShown = isActiveDiffTab(
    services.uiStateStore.getState().activeMainTab,
    target,
  );
  services.uiStateStore.setState((state) => openDiffTab(state, target, true));
  // The click that starts a double click has loaded it already.
  if (!alreadyShown) loadDiffOf(services, target);
}

// Activates an existing tab; its diff is loaded again because the controller holds the
// diff of one tab only.
export function activateDiff(
  services: GitDiffServices,
  target: GitSelection,
): void {
  services.uiStateStore.setState((state) => activateDiffTab(state, target));
  loadDiffOf(services, target);
}

export function pinDiff(services: GitDiffServices, target: GitSelection): void {
  services.uiStateStore.setState((state) => pinDiffTab(state, target));
}

// Closes the tab. When it was the active one, the neighbour's diff (if the neighbour is a
// diff tab) is loaded; with no diff tab left the controller drops its diff.
export function closeDiff(
  services: GitDiffServices,
  target: GitSelection,
): void {
  services.uiStateStore.setState((state) => closeDiffTab(state, target));
  syncLoadWithActiveTab(services);
}

function syncLoadWithActiveTab(services: GitDiffServices): void {
  const state = services.uiStateStore.getState();
  const active = activeDiffSelection(state);
  if (active !== null) loadDiffOf(services, active);
  else if (state.diffTabs.length === 0) services.gitController.clearDiff();
}

// To call once the status has changed (after Stage / Unstage, Commit or a refresh have
// settled): applies `nextDiffAction` to every diff tab (reload / switch side / close) and
// loads the diff of the tab that is active afterwards. Inactive tabs load when activated.
export function refreshDiffAfterStatusChange(services: GitDiffServices): void {
  const state = services.uiStateStore.getState();
  if (state.diffTabs.length === 0) return;
  const status = services.gitController.store.getState().status;
  const next = retargetDiffTabs(
    state.diffTabs,
    activeDiffSelection(state),
    status,
  );
  services.uiStateStore.setState((current) =>
    replaceDiffTabs(current, next.tabs, next.active),
  );
  syncLoadWithActiveTab(services);
}
