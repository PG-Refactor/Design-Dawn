// Fetch, Push, Pull and Sync as flows (docs/git-development.md §11.16, R-3). They take
// everything they need as parameters: asking (which remote? really?) belongs to the UI,
// which then calls these with the answers. Steps that span the Git controller, the
// workspace actions and the UI state live here, in one place, like the discard flow.
//
// A Pull rewrites working tree files an open Document may hold in memory. So it saves
// first, and afterwards closes the Documents WITHOUT saving (a save would write the old
// in-memory state over what git wrote) and opens them again from disk.

import type { OperationResult } from "../../application/ports/operation-error";
import { hasUnsavedProjectChanges } from "../../application/state/unsaved-changes";
import { reloadProjectFromDisk } from "../workspace/reload-from-disk";
import { setBusy } from "../workspace/ui-state/shell-ui-state";
import type { WorkspaceServices } from "../workspace/workspace-services-context";
import { refreshDiffAfterStatusChange } from "./git-diff-session";
import { reloadHistoryIfShown } from "./git-view-refresh";

export type GitFlowServices = Pick<
  WorkspaceServices,
  | "gitController"
  | "uiStateStore"
  | "applicationStore"
  | "actions"
  | "draftRegistry"
>;

// `done`: everything asked for ran. `failed`: a step failed (already reported). `skipped`:
// nothing ran because a precondition did not hold (no Project, busy, nothing to commit).
// `remoteRequired`: a Push needs a remote name (no upstream) and none was given; the UI
// asks first (`GitController.remotes`) and calls again.
export type GitFlowOutcome = "done" | "failed" | "skipped" | "remoteRequired";

// The error kind Rust gives a pull that stopped on conflicts: git then wrote conflict
// markers into the working tree although HEAD did not move.
const PULL_CONFLICT_KIND = "gitPullConflicts";

function outcomeOf(result: OperationResult<unknown>): GitFlowOutcome {
  return result.ok ? "done" : "failed";
}

export async function runGitFetch(
  services: GitFlowServices,
): Promise<GitFlowOutcome> {
  const result = await services.gitController.fetch();
  refreshDiffAfterStatusChange(services);
  return outcomeOf(result);
}

// Push when the branch has an upstream, otherwise publish it to `remote`. HEAD does not
// move, so the history is not reloaded; the ahead count follows through the status.
export async function runGitPush(
  services: GitFlowServices,
  remote: string | null,
): Promise<GitFlowOutcome> {
  const { gitController } = services;
  const status = gitController.store.getState().status;
  if (status === null || status.repositoryState !== "ready") return "skipped";
  let result: OperationResult<void>;
  if (status.branch?.upstream != null) {
    result = await gitController.push();
  } else {
    if (remote === null) return "remoteRequired";
    result = await gitController.publish(remote);
  }
  refreshDiffAfterStatusChange(services);
  return outcomeOf(result);
}

// Saves what the Pull must not lose. Open Documents are in memory; the pull changes the
// files they are read from.
async function saveBeforePull(services: GitFlowServices): Promise<boolean> {
  const { applicationStore, draftRegistry, actions } = services;
  const state = applicationStore.getState();
  const unsaved =
    hasUnsavedProjectChanges(state) ||
    draftRegistry.hasPendingFor([...state.documents.keys()]);
  if (!unsaved) return true;
  // A failure is already visible through the save's own error path.
  return (await actions.saveAll()).ok;
}

// After the pull rewrote files: every Document is read again from disk (`reloadProjectFromDisk`)
// and the history shown follows HEAD. A failure is already reported where it happened.
async function reloadAfterPull(services: GitFlowServices): Promise<void> {
  const reloaded = await reloadProjectFromDisk(services);
  if (reloaded.ok) reloadHistoryIfShown(services);
}

// The pull with its safety steps; the caller holds the busy state.
async function pullWithReload(
  services: GitFlowServices,
): Promise<GitFlowOutcome> {
  const { gitController } = services;
  if (gitController.store.getState().projectId === null) return "skipped";
  if (!(await saveBeforePull(services))) return "failed";
  const headBefore = gitController.store.getState().status?.branch?.oid ?? null;
  const result = await gitController.pull();
  const conflicted = !result.ok && result.error.kind === PULL_CONFLICT_KIND;
  const status = gitController.store.getState().status;
  // An unreadable status after the pull: HEAD is unknown, so assume it moved.
  const headMoved =
    status === null || (status.branch?.oid ?? null) !== headBefore;
  if (conflicted || (result.ok && headMoved)) await reloadAfterPull(services);
  refreshDiffAfterStatusChange(services);
  return outcomeOf(result);
}

// Runs `flow` under the workspace busy state, so nothing is edited meanwhile. A second call
// while it runs does nothing (the busy state is set before the first await).
async function withBusy(
  services: GitFlowServices,
  flow: () => Promise<GitFlowOutcome>,
): Promise<GitFlowOutcome> {
  const { uiStateStore } = services;
  if (uiStateStore.getState().busy) return "skipped";
  uiStateStore.setState((state) => setBusy(state, true));
  try {
    return await flow();
  } finally {
    uiStateStore.setState((state) => setBusy(state, false));
  }
}

export function runGitPull(services: GitFlowServices): Promise<GitFlowOutcome> {
  return withBusy(services, () => pullWithReload(services));
}

// Pull, then Push only when the pull succeeded. The branch has an upstream (the pull
// needs one), so the push never needs a remote name.
export function runGitSync(services: GitFlowServices): Promise<GitFlowOutcome> {
  return withBusy(services, async () => {
    const pulled = await pullWithReload(services);
    if (pulled !== "done") return pulled;
    return runGitPush(services, null);
  });
}
