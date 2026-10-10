// Putting the workspace view back after a Git operation rewrote files the open Documents
// are read from (Discard, Pull; docs/git-development.md §11.16). The operation closes the
// affected Documents WITHOUT saving, runs, then opens them again from disk; these helpers
// capture and restore what the user was looking at.

import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
import { restoreMainTab } from "../workspace/ui-state/diff-tabs";
import type { DiffTab, MainTabRef } from "../workspace/ui-state/ui-state";
import type { WorkspaceServices } from "../workspace/workspace-services-context";

export type ViewServices = Pick<
  WorkspaceServices,
  "uiStateStore" | "applicationStore" | "actions"
>;

// The view as it was before a Git operation that rewrites files, to put back afterwards.
export interface ViewSnapshot {
  // Open Documents in tab order.
  readonly openDocumentIds: readonly DocumentId[];
  readonly activeDocumentId: DocumentId | null;
  readonly activeSheets: ReadonlyMap<DocumentId, SheetId>;
  readonly mainTab: MainTabRef;
  readonly diffTabs: readonly DiffTab[];
}

export function captureView(services: ViewServices): ViewSnapshot {
  const application = services.applicationStore.getState();
  const ui = services.uiStateStore.getState();
  return {
    openDocumentIds: [...application.documents.keys()],
    activeDocumentId: ui.activeDocumentId,
    activeSheets: ui.activeSheetIdByDocument,
    mainTab: ui.activeMainTab,
    diffTabs: ui.diffTabs,
  };
}

export function isOpen(
  services: ViewServices,
  documentId: DocumentId,
): boolean {
  return services.applicationStore.getState().documents.has(documentId);
}

// Opens the Documents again. Ones the Project no longer has are skipped by the action (the
// UI never offers them); a real open failure is recorded by it and does not stop the rest.
export async function reopenDocuments(
  services: ViewServices,
  documentIds: readonly DocumentId[],
  view: ViewSnapshot,
): Promise<void> {
  const { actions } = services;
  for (const documentId of documentIds) {
    if (isOpen(services, documentId)) continue;
    await actions.openDocument(documentId);
    const sheetId = view.activeSheets.get(documentId);
    if (sheetId !== undefined && isOpen(services, documentId)) {
      await actions.selectSheet(documentId, sheetId);
    }
  }
}

// The Document tab order as it was, for the Documents that are open.
export function restoreTabOrder(
  services: ViewServices,
  view: ViewSnapshot,
): void {
  const { actions } = services;
  // Moving each remembered tab to the end in turn leaves them in the remembered order.
  for (const documentId of view.openDocumentIds) {
    if (isOpen(services, documentId)) actions.moveDocumentTab(documentId, null);
  }
}

// The active Document and the active main tab (Document or diff) as they were, as far as
// they still exist.
export async function restoreActive(
  services: ViewServices,
  view: ViewSnapshot,
): Promise<void> {
  const { actions, uiStateStore } = services;
  if (
    view.activeDocumentId !== null &&
    isOpen(services, view.activeDocumentId)
  ) {
    await actions.openDocument(view.activeDocumentId);
  }
  uiStateStore.setState((state) => restoreMainTab(state, view.mainTab));
}

// The Project reopen reset the diff tabs; they are the Git panel's view, not Project data.
export function restoreDiffTabs(
  services: ViewServices,
  view: ViewSnapshot,
): void {
  services.uiStateStore.setState((state) =>
    state.diffTabs.length === 0 ? { ...state, diffTabs: view.diffTabs } : state,
  );
}
