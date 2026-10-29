// Builds the ExternalChangeController for the app: the application-layer rules plus the pieces
// that live in the UI layer (reading a Document or the Project again with the view restored,
// the draft registry, the busy state). Used by the composition root and by the test harness.

import {
  createExternalChangeController,
  type ExternalChangeController,
} from "../../application/external-change/external-change-controller";
import type { PersistenceGateway } from "../../application/ports/persistence-gateway";
import type { ApplicationStore } from "../../application/state/application-state";
import type { Workspace } from "../../application/workspace/workspace";
import type { DraftRegistry } from "../workspace/draft-registry";
import {
  reloadDocumentFromDisk,
  reloadProjectFromDisk,
} from "../workspace/reload-from-disk";
import { setBusy } from "../workspace/ui-state/shell-ui-state";
import type { UiStateStore } from "../workspace/ui-state/ui-state";
import type { WorkspaceActions } from "../workspace/workspace-actions";

export interface AppExternalChangeDependencies {
  readonly gateway: PersistenceGateway;
  readonly workspace: Workspace;
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
  readonly actions: WorkspaceActions;
  readonly draftRegistry: DraftRegistry;
}

export function createAppExternalChangeController(
  dependencies: AppExternalChangeDependencies,
): ExternalChangeController {
  const {
    gateway,
    workspace,
    applicationStore,
    uiStateStore,
    actions,
    draftRegistry,
  } = dependencies;
  const reloadServices = { uiStateStore, applicationStore, actions };

  // Nothing may be edited while Documents are closed and opened again.
  async function underBusy<T>(task: () => Promise<T>): Promise<T> {
    const wasBusy = uiStateStore.getState().busy;
    uiStateStore.setState((state) => setBusy(state, true));
    try {
      return await task();
    } finally {
      uiStateStore.setState((state) => setBusy(state, wasBusy));
    }
  }

  return createExternalChangeController({
    gateway,
    applicationStore,
    getDocumentSession: (documentId) =>
      workspace.getDocumentSession(documentId),
    hasPendingDraft: (documentIds) => draftRegistry.hasPendingFor(documentIds),
    reload: {
      document: (documentId) =>
        underBusy(() => reloadDocumentFromDisk(reloadServices, documentId)),
      project: () => underBusy(() => reloadProjectFromDisk(reloadServices)),
    },
    saveAll: () => actions.saveAll(),
    isBlocked: () => uiStateStore.getState().busy,
  });
}
