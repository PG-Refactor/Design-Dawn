// Discarding Git changes (docs/ui-design.md §13.5, V-5): ask, close what is affected, discard,
// bring everything back. The steps and their order live here, in one place, because they
// span the Git controller, the workspace actions and the UI state; components only call
// `requestGitDiscard` and `confirmGitDiscard`.
//
// A discard rewrites files an open Document may hold in memory. Those Documents are
// therefore closed WITHOUT saving (a save would write the discarded state back) and opened
// again afterwards, which reads the files from disk: Rust keeps only paths and a hash ledger
// for a Document, never its content, and `load_document` rescans the Document directory.

import type { DocumentId } from "../../domain/shared/entity-id";
import {
  addOperationError,
  closeDialog,
  openDialog,
  setBusy,
} from "../workspace/ui-state/shell-ui-state";
import type {
  DialogState,
  DiscardTarget,
} from "../workspace/ui-state/ui-state";
import type { WorkspaceServices } from "../workspace/workspace-services-context";
import { refreshDiffAfterStatusChange } from "./git-diff-session";
import {
  captureView,
  reopenDocuments,
  restoreActive,
  restoreDiffTabs,
  restoreTabOrder,
} from "./git-view-restore";

export type GitDiscardServices = Pick<
  WorkspaceServices,
  "gitController" | "uiStateStore" | "applicationStore" | "actions"
>;

type DiscardDialog = Extract<
  DialogState,
  { readonly kind: "confirmDiscardGitChanges" }
>;

// A question whose impact is being read, per UI state store: a second click meanwhile must
// not open a second question.
const pendingRequests = new WeakSet<GitDiscardServices["uiStateStore"]>();

// Reads the impact and opens the confirmation. Nothing is changed yet; a failed read is
// reported (as the discard itself would be) and no question is asked.
export async function requestGitDiscard(
  services: GitDiscardServices,
  targets: readonly DiscardTarget[],
): Promise<void> {
  const { uiStateStore, gitController } = services;
  if (targets.length === 0 || pendingRequests.has(uiStateStore)) return;
  const initial = uiStateStore.getState();
  if (initial.busy || initial.dialog.kind !== "none") return;
  pendingRequests.add(uiStateStore);
  try {
    const impact = await gitController.discardImpact(
      targets.map((target) => target.path),
    );
    if (!impact.ok) {
      uiStateStore.setState((state) =>
        addOperationError(state, "discardGitChanges", null, impact.error),
      );
      return;
    }
    const current = uiStateStore.getState();
    if (current.busy || current.dialog.kind !== "none") return;
    uiStateStore.setState((state) =>
      openDialog(state, {
        kind: "confirmDiscardGitChanges",
        targets,
        documentIds: impact.value.documentIds,
        projectFilesAffected: impact.value.projectFilesAffected,
      }),
    );
  } finally {
    pendingRequests.delete(uiStateStore);
  }
}

async function runDiscard(
  services: GitDiscardServices,
  dialog: DiscardDialog,
): Promise<void> {
  const { actions, gitController } = services;
  const view = captureView(services);
  const affected = view.openDocumentIds.filter((documentId) =>
    dialog.documentIds.includes(documentId),
  );

  // Brings back what this flow closed, then the view; used when the discard is not run.
  async function abandon(closed: readonly DocumentId[]): Promise<void> {
    await reopenDocuments(services, closed, view);
    restoreTabOrder(services, view);
    await restoreActive(services, view);
  }

  const closed: DocumentId[] = [];
  for (const documentId of affected) {
    const result = await actions.closeDocumentWithoutSaving(documentId);
    if (!result.ok) {
      await abandon(closed);
      return;
    }
    closed.push(documentId);
  }

  if (dialog.projectFilesAffected) {
    // After the closes: nothing may be left pending that could write after the restore.
    const saved = await actions.saveAll();
    if (!saved.ok) {
      await abandon(closed);
      return;
    }
  }

  const discarded = await gitController.discard(
    dialog.targets.map((target) => target.path),
  );

  const reopensProject = dialog.projectFilesAffected && discarded.ok;
  if (reopensProject) {
    const reopened = await actions.reopenProject();
    // Not reopened: the Project is closed, so there is nothing to bring back.
    if (reopened.ok && !reopened.value) return;
    restoreDiffTabs(services, view);
  }
  await reopenDocuments(
    services,
    reopensProject ? view.openDocumentIds : closed,
    view,
  );
  restoreTabOrder(services, view);
  await restoreActive(services, view);
  refreshDiffAfterStatusChange(services);
}

// The answer "discard": runs the whole flow under the workspace busy state, so nothing is
// edited meanwhile, and closes the question afterwards. A second call while it runs does
// nothing (the busy state is set before the first await).
export async function confirmGitDiscard(
  services: GitDiscardServices,
): Promise<void> {
  const { uiStateStore } = services;
  const { dialog, busy } = uiStateStore.getState();
  if (busy || dialog.kind !== "confirmDiscardGitChanges") return;
  uiStateStore.setState((state) => setBusy(state, true));
  try {
    await runDiscard(services, dialog);
  } finally {
    uiStateStore.setState((state) => setBusy(closeDialog(state), false));
  }
}
