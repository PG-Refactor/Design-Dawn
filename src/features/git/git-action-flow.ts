// What the commit form and the menus ask before a Git action runs (docs/ui-design.md
// §13.6, R-4): smart commit (stage everything?) and which remote to publish to. Both are
// Workspace questions in the UI state; this module opens them and continues with the
// answer, so the components only call these functions. The flows that do the work are
// `git-commit-flow.ts` and `git-remote-flow.ts`.
//
// Questions come BEFORE anything runs (a remote is asked before the commit of Commit &
// Push), so cancelling one changes nothing.

import {
  addOperationError,
  closeDialog,
  openDialog,
} from "../workspace/ui-state/shell-ui-state";
import type {
  GitCommitFollowUp,
  GitRemoteContinuation,
} from "../workspace/ui-state/ui-state";
import {
  deriveGitChangeSections,
  type GitChangeSectionId,
} from "./git-change-sections";
import { runGitCommit } from "./git-commit-flow";
import {
  type GitFlowOutcome,
  type GitFlowServices,
  runGitPush,
} from "./git-remote-flow";

export interface GitCommitAction {
  readonly amend: boolean;
  readonly followUp: GitCommitFollowUp;
}

type RemoteResolution =
  | { readonly kind: "ready"; readonly remote: string | null }
  | { readonly kind: "stopped" };

// Operation label for a missing remote: the closest user-level operation to "publish".
const NO_REMOTE_LABEL = "publishGit";
const NO_REMOTE_ERROR_KIND = "gitNoRemote";
const NO_REMOTE_DETAIL = "the repository has no remote";

// A question whose remotes are being read, per UI state store: a second click meanwhile
// must not open a second question.
const pendingRequests = new WeakSet<GitFlowServices["uiStateStore"]>();

function questionAllowed(services: GitFlowServices): boolean {
  const ui = services.uiStateStore.getState();
  return !ui.busy && ui.dialog.kind === "none";
}

// The remote a publish goes to. A branch with an upstream needs none (null). Otherwise: no
// remote is reported (never a silent failure), one is used, several are asked.
async function resolveRemote(
  services: GitFlowServices,
  continuation: GitRemoteContinuation,
): Promise<RemoteResolution> {
  const { gitController, uiStateStore } = services;
  const status = gitController.store.getState().status;
  if (status === null || status.repositoryState !== "ready") {
    return { kind: "stopped" };
  }
  if (status.branch?.upstream != null) return { kind: "ready", remote: null };
  const names = await gitController.remotes();
  if (!names.ok) {
    uiStateStore.setState((state) =>
      addOperationError(state, NO_REMOTE_LABEL, null, names.error),
    );
    return { kind: "stopped" };
  }
  const [only, ...others] = names.value;
  if (only === undefined) {
    uiStateStore.setState((state) =>
      addOperationError(state, NO_REMOTE_LABEL, null, {
        kind: NO_REMOTE_ERROR_KIND,
        detail: NO_REMOTE_DETAIL,
      }),
    );
    return { kind: "stopped" };
  }
  if (others.length === 0) return { kind: "ready", remote: only };
  // The state may have changed while the names were read.
  if (!questionAllowed(services)) return { kind: "stopped" };
  uiStateStore.setState((state) =>
    openDialog(state, {
      kind: "chooseGitRemote",
      remoteNames: names.value,
      continuation,
    }),
  );
  return { kind: "stopped" };
}

function hasSections(
  services: GitFlowServices,
  ids: readonly GitChangeSectionId[],
): readonly boolean[] {
  const status = services.gitController.store.getState().status;
  const sections = status === null ? [] : deriveGitChangeSections(status);
  return ids.map((id) => sections.some((section) => section.id === id));
}

// Past the remote: asks to stage everything when nothing is staged, otherwise commits.
async function startCommit(
  services: GitFlowServices,
  action: GitCommitAction,
  remote: string | null,
): Promise<GitFlowOutcome> {
  const { uiStateStore } = services;
  if (!action.amend) {
    // The draft is what is sent; a question for a commit that cannot be made is pointless.
    if (uiStateStore.getState().gitCommitMessage.trim() === "")
      return "skipped";
    const [conflicts, staged, changes] = hasSections(services, [
      "conflicts",
      "staged",
      "changes",
    ]);
    if (!staged) {
      // Nothing to stage, or a merge in the way (Rust would refuse the commit anyway).
      if (!changes || conflicts || !questionAllowed(services)) return "skipped";
      uiStateStore.setState((state) =>
        openDialog(state, {
          kind: "confirmGitStageAll",
          followUp: action.followUp,
          remote,
        }),
      );
      return "skipped";
    }
  }
  return runGitCommit(services, {
    amend: action.amend,
    stageAll: false,
    followUp: action.followUp,
    remote,
  });
}

// Commit, Commit (Amend), Commit & Push and Commit & Sync from the form or a menu.
export async function requestGitCommit(
  services: GitFlowServices,
  action: GitCommitAction,
): Promise<GitFlowOutcome> {
  const { uiStateStore, gitController } = services;
  if (pendingRequests.has(uiStateStore) || !questionAllowed(services)) {
    return "skipped";
  }
  if (gitController.store.getState().operating) return "skipped";
  if (action.followUp !== "push") return startCommit(services, action, null);
  pendingRequests.add(uiStateStore);
  try {
    const resolved = await resolveRemote(services, "commitAndPush");
    if (resolved.kind === "stopped") return "skipped";
    return await startCommit(services, action, resolved.remote);
  } finally {
    pendingRequests.delete(uiStateStore);
  }
}

// Push, or publish the branch when it has no upstream.
export async function requestGitPush(
  services: GitFlowServices,
): Promise<GitFlowOutcome> {
  const { uiStateStore } = services;
  if (pendingRequests.has(uiStateStore) || !questionAllowed(services)) {
    return "skipped";
  }
  pendingRequests.add(uiStateStore);
  try {
    const resolved = await resolveRemote(services, "push");
    if (resolved.kind === "stopped") return "skipped";
    return await runGitPush(services, resolved.remote);
  } finally {
    pendingRequests.delete(uiStateStore);
  }
}

// The answer "yes" of the smart commit question: stage everything and commit.
export async function confirmGitStageAll(
  services: GitFlowServices,
): Promise<GitFlowOutcome> {
  const { uiStateStore } = services;
  const { dialog } = uiStateStore.getState();
  if (dialog.kind !== "confirmGitStageAll") return "skipped";
  uiStateStore.setState((state) => closeDialog(state));
  return runGitCommit(services, {
    amend: false,
    stageAll: true,
    followUp: dialog.followUp,
    remote: dialog.remote,
  });
}

// The answer of the remote question: continues with the picked remote.
export async function confirmGitRemote(
  services: GitFlowServices,
  remote: string,
): Promise<GitFlowOutcome> {
  const { uiStateStore } = services;
  const { dialog } = uiStateStore.getState();
  if (dialog.kind !== "chooseGitRemote") return "skipped";
  if (!dialog.remoteNames.includes(remote)) return "skipped";
  uiStateStore.setState((state) => closeDialog(state));
  return dialog.continuation === "push"
    ? runGitPush(services, remote)
    : startCommit(services, { amend: false, followUp: "push" }, remote);
}
