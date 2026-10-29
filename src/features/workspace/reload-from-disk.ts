// Reading Documents or the whole Project again from disk and putting the view back
// (docs/architecture.md §14.8). One implementation for everything that rewrites files under
// open Documents: a Git Pull, and a change made outside the app. The Documents are closed
// WITHOUT saving (a save would write the old in-memory state over what is on disk) and
// opened again, which reads the files fresh. Callers have already dealt with unsaved changes
// (saved them, or asked the user), and hold the busy state themselves.

import {
  type OperationResult,
  operationOk,
} from "../../application/ports/operation-error";
import type { DocumentId } from "../../domain/shared/entity-id";
import {
  captureView,
  isOpen,
  reopenDocuments,
  restoreActive,
  restoreDiffTabs,
  restoreTabOrder,
} from "./view-restore";
import type { WorkspaceServices } from "./workspace-services-context";

export type ReloadServices = Pick<
  WorkspaceServices,
  "uiStateStore" | "applicationStore" | "actions"
>;

// Closes every open Document unsaved, reads the Project again and brings the Documents and
// the view back. Nothing is written here: the Project reload saves only what is dirty, and no
// Document is open any more. A failure to close a Document stops everything before the
// reload (reloading with a Document still open could write it over the files).
export async function reloadProjectFromDisk(
  services: ReloadServices,
): Promise<OperationResult<void>> {
  const { actions, uiStateStore } = services;
  const view = captureView(services);
  // Reopening the Project resets the UI state with its notifications, which would wipe a
  // failure the user has to see (a Pull's conflict). They are put back afterwards.
  const { operationErrors, nextOperationErrorId } = uiStateStore.getState();
  for (const documentId of view.openDocumentIds) {
    const closed = await actions.closeDocumentWithoutSaving(documentId);
    if (!closed.ok) return closed;
  }
  const reopened = await actions.reopenProject();
  if (!reopened.ok) return reopened;
  // Not reopened: the Project is closed, so there is nothing to bring back.
  if (!reopened.value) return operationOk(undefined);
  restoreDiffTabs(services, view);
  uiStateStore.setState((state) => ({
    ...state,
    // Ids stay unique: whatever the reopen itself reported follows the earlier ones.
    operationErrors: [
      ...operationErrors,
      ...state.operationErrors.map((entry) => ({
        ...entry,
        id: entry.id + nextOperationErrorId,
      })),
    ],
    nextOperationErrorId: state.nextOperationErrorId + nextOperationErrorId,
  }));
  await reopenDocuments(services, view.openDocumentIds, view);
  restoreTabOrder(services, view);
  await restoreActive(services, view);
  return operationOk(undefined);
}

// Closes one open Document unsaved and opens it again from disk, with its active Sheet, its
// place among the tabs and the active tab as they were. Its Undo history ends. When it cannot
// be opened again it stays closed (the failure is recorded by the open) and the error is
// returned.
export async function reloadDocumentFromDisk(
  services: ReloadServices,
  documentId: DocumentId,
): Promise<OperationResult<void>> {
  if (!isOpen(services, documentId)) return operationOk(undefined);
  const view = captureView(services);
  const closed = await services.actions.closeDocumentWithoutSaving(documentId);
  if (!closed.ok) return closed;
  const opened = await services.actions.openDocument(documentId);
  if (opened.ok) {
    const sheetId = view.activeSheets.get(documentId);
    if (sheetId !== undefined) {
      await services.actions.selectSheet(documentId, sheetId);
    }
    restoreTabOrder(services, view);
  }
  await restoreActive(services, view);
  return opened;
}
