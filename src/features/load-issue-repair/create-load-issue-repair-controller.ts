// Builds the LoadIssueRepairController for the app: the application-layer steps plus the
// pieces that live in the UI layer (reading a Document or the Project again with the view
// restored, the draft registry, the busy state, the notifications). Used by the composition
// root and by the test harness.

import {
  createLoadIssueRepairController,
  type LoadIssueRepairController,
  type RepairDone,
  type RepairOperation,
  type RepairTarget,
} from "../../application/load-issue-repair/load-issue-repair-controller";
import type { OperationError } from "../../application/ports/operation-error";
import type { PersistenceGateway } from "../../application/ports/persistence-gateway";
import type { ApplicationStore } from "../../application/state/application-state";
import {
  hasUnsavedDocumentChanges,
  hasUnsavedProjectChanges,
} from "../../application/state/unsaved-changes";
import type { DraftRegistry } from "../workspace/draft-registry";
import {
  reloadDocumentFromDisk,
  reloadProjectFromDisk,
} from "../workspace/reload-from-disk";
import {
  addOperationError,
  setBusy,
  showNotice,
} from "../workspace/ui-state/shell-ui-state";
import type { NoticeKind, UiStateStore } from "../workspace/ui-state/ui-state";
import type { WorkspaceActions } from "../workspace/workspace-actions";

export interface AppLoadIssueRepairDependencies {
  readonly gateway: PersistenceGateway;
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
  readonly actions: WorkspaceActions;
  readonly draftRegistry: DraftRegistry;
}

const NOTICE_OF: Readonly<Record<RepairDone, NoticeKind>> = {
  repaired: "loadIssueRepaired",
  reloaded: "filesReloaded",
  formatUpdated: "fileFormatUpdated",
};

export function createAppLoadIssueRepairController(
  dependencies: AppLoadIssueRepairDependencies,
): LoadIssueRepairController {
  const { gateway, applicationStore, uiStateStore, actions, draftRegistry } =
    dependencies;
  const reloadServices = { uiStateStore, applicationStore, actions };

  // Nothing may be edited while files change and Documents are closed and opened again.
  async function underBusy<T>(task: () => Promise<T>): Promise<T> {
    const wasBusy = uiStateStore.getState().busy;
    uiStateStore.setState((state) => setBusy(state, true));
    try {
      return await task();
    } finally {
      uiStateStore.setState((state) => setBusy(state, wasBusy));
    }
  }

  function hasUnsaved(target: RepairTarget): boolean {
    const state = applicationStore.getState();
    if (target.scope === "document") {
      return (
        hasUnsavedDocumentChanges(state, [target.documentId]) ||
        draftRegistry.hasPendingFor([target.documentId])
      );
    }
    return (
      hasUnsavedProjectChanges(state) ||
      draftRegistry.hasPendingFor([...state.documents.keys()])
    );
  }

  return createLoadIssueRepairController({
    gateway,
    applicationStore,
    hasUnsaved,
    saveAll: () => actions.saveAll(),
    reload: {
      document: (documentId) =>
        reloadDocumentFromDisk(reloadServices, documentId),
      project: () => reloadProjectFromDisk(reloadServices),
    },
    underBusy,
    isBlocked: () => uiStateStore.getState().busy,
    reportFailure: (operation: RepairOperation, error: OperationError) =>
      uiStateStore.setState((state) =>
        addOperationError(state, operation, null, error),
      ),
    notifyDone: (done) =>
      uiStateStore.setState((state) => showNotice(state, NOTICE_OF[done])),
  });
}
