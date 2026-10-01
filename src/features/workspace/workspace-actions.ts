// The only module of the UI that calls the Workspace (and through it the document
// sessions) and updates UI state. Components call these actions; they never touch
// gateways, Tauri or the filesystem. Framework-free, so it is tested without a DOM.
//
// Failures are returned AND recorded as operation errors (shown in the notifications),
// never swallowed. Save retries are the exception: a failed retry already leaves the
// session / project save error in the application state, which is what is displayed.
// A cancelled folder dialog is not an error and changes nothing.

import {
  type OperationError,
  type OperationResult,
  operationOk,
} from "../../application/ports/operation-error";
import { FOLDER_SELECTION_STATUS } from "../../application/ports/persistence-types";
import type { ApplicationStore } from "../../application/state/application-state";
import type {
  DestructiveConfirmation,
  Workspace,
} from "../../application/workspace/workspace";
import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
import {
  addOperationError,
  closeDialog,
  dismissOperationError,
  openDialog,
  setBusy,
  setNotificationsOpen,
} from "./ui-state/shell-ui-state";
import {
  type OperationLabel,
  setActiveDocument,
  setActiveSheet,
  type UiStateStore,
} from "./ui-state/ui-state";
import { firstLoadedSheetId } from "./view-models/tabs-model";
import { MESSAGES } from "./workspace-messages";

export interface WorkspaceActions {
  openProjectViaDialog(): Promise<OperationResult<void>>;
  requestCreateProject(): void;
  createProjectViaDialog(name: string): Promise<OperationResult<void>>;
  closeProject(): Promise<OperationResult<void>>;

  // Opens the document if needed, makes it active and activates its first sheet when
  // none is active. A document that failed to load is left alone.
  openDocument(documentId: DocumentId): Promise<OperationResult<void>>;
  // Saves first (the workspace decides); on success the neighbouring tab becomes active.
  closeDocument(documentId: DocumentId): Promise<OperationResult<void>>;
  selectSheet(
    documentId: DocumentId,
    sheetId: SheetId,
  ): Promise<OperationResult<void>>;

  requestCreateDocument(): void;
  createDocument(name: string): Promise<OperationResult<void>>;
  // Opens the document first if needed, then asks for the name.
  requestCreateSheet(documentId: DocumentId): Promise<OperationResult<void>>;
  createSheet(
    documentId: DocumentId,
    name: string,
  ): Promise<OperationResult<void>>;

  requestDeleteDocument(documentId: DocumentId): void;
  requestDeleteSheet(documentId: DocumentId, sheetId: SheetId): void;
  // Runs the deletion the dialog asked for, passing the user's confirmation.
  confirmDelete(): Promise<OperationResult<void>>;
  cancelDialog(): void;

  retryDocumentSave(documentId: DocumentId): Promise<OperationResult<void>>;
  retryProjectSave(): Promise<OperationResult<void>>;

  dismissOperationError(id: number): void;
  setNotificationsOpen(open: boolean): void;
}

export interface WorkspaceActionsDependencies {
  readonly workspace: Workspace;
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
}

const USER_CONFIRMATION: DestructiveConfirmation = { confirmedByUser: true };

// The element after the removed one, else the one before it; null when none is left.
function neighbourOf<Id>(order: readonly Id[], removed: Id): Id | null {
  const index = order.indexOf(removed);
  if (index < 0) return null;
  return order[index + 1] ?? order[index - 1] ?? null;
}

export function createWorkspaceActions(
  dependencies: WorkspaceActionsDependencies,
): WorkspaceActions {
  const { workspace, applicationStore, uiStateStore } = dependencies;

  function record(
    operation: OperationLabel,
    subject: string | null,
    error: OperationError,
  ): void {
    uiStateStore.setState((state) =>
      addOperationError(state, operation, subject, error),
    );
  }

  // Disables repeated clicks while a workspace operation is running.
  async function runBusy<T>(task: () => Promise<T>): Promise<T> {
    uiStateStore.setState((state) => setBusy(state, true));
    try {
      return await task();
    } finally {
      uiStateStore.setState((state) => setBusy(state, false));
    }
  }

  function documentNameOf(documentId: DocumentId): string | null {
    const entry = applicationStore
      .getState()
      .project?.documents.find(
        (candidate) => candidate.documentId === documentId,
      );
    return entry?.name ?? null;
  }

  function activateSheet(documentId: DocumentId, sheetId: SheetId): void {
    uiStateStore.setState((state) =>
      setActiveSheet(setActiveDocument(state, documentId), documentId, sheetId),
    );
  }

  // Keeps the active sheet of a document valid: the remembered one when it still is a
  // loaded sheet, else `preferred`, else the first loaded sheet.
  function ensureActiveSheet(
    documentId: DocumentId,
    preferred: SheetId | null,
  ): void {
    const application = applicationStore.getState();
    const loaded = (
      application.documentDetails.get(documentId)?.sheetEntries ?? []
    ).filter((entry) => entry.state === "loaded");
    const current = uiStateStore
      .getState()
      .activeSheetIdByDocument.get(documentId);
    if (loaded.some((entry) => entry.sheetId === current)) return;
    const target =
      preferred !== null && loaded.some((entry) => entry.sheetId === preferred)
        ? preferred
        : firstLoadedSheetId(application, documentId);
    if (target !== null) {
      uiStateStore.setState((state) =>
        setActiveSheet(state, documentId, target),
      );
    }
  }

  function activateDocument(documentId: DocumentId): void {
    uiStateStore.setState((state) => setActiveDocument(state, documentId));
    ensureActiveSheet(documentId, null);
  }

  // Resolves to whether the document is open afterwards. A document that failed to load
  // is not an error here: the UI never offers to open it.
  async function ensureOpen(
    documentId: DocumentId,
  ): Promise<OperationResult<boolean>> {
    const application = applicationStore.getState();
    if (application.documents.has(documentId)) return operationOk(true);
    const entry = application.project?.documents.find(
      (candidate) => candidate.documentId === documentId,
    );
    if (entry?.state !== "loaded") return operationOk(false);
    const opened = await workspace.openDocument(documentId);
    if (!opened.ok) {
      record("openDocument", entry.name, opened.error);
      return opened;
    }
    return operationOk(true);
  }

  // After a document was closed or deleted: when it was the active one, the neighbouring
  // tab takes over (tab order as it was before the removal).
  function activateNeighbourTab(
    removed: DocumentId,
    orderBefore: readonly DocumentId[],
    wasActive: boolean,
  ): void {
    if (!wasActive) return;
    if (applicationStore.getState().documents.has(removed)) return;
    const neighbour = neighbourOf(orderBefore, removed);
    if (neighbour !== null) activateDocument(neighbour);
  }

  async function finishRemoval(
    documentId: DocumentId,
    removal: () => Promise<OperationResult<void>>,
  ): Promise<OperationResult<void>> {
    const orderBefore = [...applicationStore.getState().documents.keys()];
    const wasActive = uiStateStore.getState().activeDocumentId === documentId;
    const result = await removal();
    activateNeighbourTab(documentId, orderBefore, wasActive);
    return result;
  }

  async function openOrCreateProject(
    operation: "openProject" | "createProject",
    name: string | null,
  ): Promise<OperationResult<void>> {
    return runBusy(async () => {
      const selected = await workspace.selectProjectFolder();
      if (!selected.ok) {
        record("selectFolder", null, selected.error);
        return selected;
      }
      if (selected.value.status === FOLDER_SELECTION_STATUS.cancelled) {
        return operationOk(undefined);
      }
      const { selectionId } = selected.value;
      const result =
        name === null
          ? await workspace.openProject(selectionId)
          : await workspace.createProject(selectionId, name);
      uiStateStore.setState(closeDialog);
      if (!result.ok) record(operation, null, result.error);
      return result;
    });
  }

  async function deleteDocumentConfirmed(
    documentId: DocumentId,
    name: string,
  ): Promise<OperationResult<void>> {
    const result = await finishRemoval(documentId, () =>
      workspace.deleteDocument(documentId, USER_CONFIRMATION),
    );
    if (!result.ok) record("deleteDocument", name, result.error);
    return result;
  }

  async function deleteSheetConfirmed(
    documentId: DocumentId,
    sheetId: SheetId,
    name: string,
  ): Promise<OperationResult<void>> {
    const loadedOrder = (
      applicationStore.getState().documentDetails.get(documentId)
        ?.sheetEntries ?? []
    )
      .filter((entry) => entry.state === "loaded")
      .map((entry) => entry.sheetId);
    const wasActive =
      uiStateStore.getState().activeSheetIdByDocument.get(documentId) ===
      sheetId;
    const result = await workspace.deleteSheet(
      documentId,
      sheetId,
      USER_CONFIRMATION,
    );
    if (!result.ok) {
      record("deleteSheet", name, result.error);
      return result;
    }
    if (wasActive)
      ensureActiveSheet(documentId, neighbourOf(loadedOrder, sheetId));
    return result;
  }

  return {
    openProjectViaDialog: () => {
      if (uiStateStore.getState().busy)
        return Promise.resolve(operationOk(undefined));
      return openOrCreateProject("openProject", null);
    },
    requestCreateProject() {
      uiStateStore.setState((state) =>
        openDialog(state, { kind: "createProject" }),
      );
    },
    createProjectViaDialog: (name) => {
      if (uiStateStore.getState().busy)
        return Promise.resolve(operationOk(undefined));
      return openOrCreateProject("createProject", name);
    },
    closeProject: () =>
      runBusy(async () => {
        const result = await workspace.closeProject();
        if (!result.ok) record("closeProject", null, result.error);
        return result;
      }),

    async openDocument(documentId) {
      const opened = await ensureOpen(documentId);
      if (!opened.ok) return opened;
      if (opened.value) activateDocument(documentId);
      return operationOk(undefined);
    },
    async closeDocument(documentId) {
      const name = documentNameOf(documentId);
      const result = await finishRemoval(documentId, () =>
        workspace.closeDocument(documentId),
      );
      if (!result.ok) record("closeDocument", name, result.error);
      return result;
    },
    async selectSheet(documentId, sheetId) {
      const opened = await ensureOpen(documentId);
      if (!opened.ok) return opened;
      if (!opened.value) return operationOk(undefined);
      const entry = applicationStore
        .getState()
        .documentDetails.get(documentId)
        ?.sheetEntries.find((candidate) => candidate.sheetId === sheetId);
      if (entry?.state !== "loaded") return operationOk(undefined);
      activateSheet(documentId, sheetId);
      return operationOk(undefined);
    },

    requestCreateDocument() {
      uiStateStore.setState((state) =>
        openDialog(state, { kind: "createDocument" }),
      );
    },
    createDocument: (name) =>
      runBusy(async () => {
        const created = await workspace.createDocument(name);
        uiStateStore.setState(closeDialog);
        if (!created.ok) {
          record("createDocument", null, created.error);
          return created;
        }
        const opened = await ensureOpen(created.value);
        if (!opened.ok) return opened;
        if (opened.value) activateDocument(created.value);
        return operationOk(undefined);
      }),
    async requestCreateSheet(documentId) {
      const opened = await ensureOpen(documentId);
      if (!opened.ok) return opened;
      if (opened.value) {
        uiStateStore.setState((state) =>
          openDialog(state, { kind: "createSheet", documentId }),
        );
      }
      return operationOk(undefined);
    },
    createSheet: (documentId, name) =>
      runBusy(async () => {
        const created = await workspace.createSheet(documentId, name);
        uiStateStore.setState(closeDialog);
        if (!created.ok) {
          record("createSheet", documentNameOf(documentId), created.error);
          return created;
        }
        activateSheet(documentId, created.value);
        return operationOk(undefined);
      }),

    requestDeleteDocument(documentId) {
      const project = applicationStore.getState().project;
      const known = project?.documents.some(
        (entry) => entry.documentId === documentId,
      );
      if (known !== true) return;
      uiStateStore.setState((state) =>
        openDialog(state, {
          kind: "confirmDeleteDocument",
          documentId,
          name: documentNameOf(documentId) ?? MESSAGES.tree.unnamedEntity,
        }),
      );
    },
    requestDeleteSheet(documentId, sheetId) {
      const entry = applicationStore
        .getState()
        .documentDetails.get(documentId)
        ?.sheetEntries.find((candidate) => candidate.sheetId === sheetId);
      if (entry === undefined) return;
      uiStateStore.setState((state) =>
        openDialog(state, {
          kind: "confirmDeleteSheet",
          documentId,
          sheetId,
          name: entry.name ?? MESSAGES.tree.unnamedEntity,
        }),
      );
    },
    confirmDelete() {
      const { dialog, busy } = uiStateStore.getState();
      if (busy) return Promise.resolve(operationOk(undefined));
      if (
        dialog.kind !== "confirmDeleteDocument" &&
        dialog.kind !== "confirmDeleteSheet"
      ) {
        return Promise.resolve(operationOk(undefined));
      }
      // The dialog stays open while the deletion runs, then closes: focus is restored
      // after the entity is gone from the tree.
      return runBusy(async () => {
        const result =
          dialog.kind === "confirmDeleteDocument"
            ? await deleteDocumentConfirmed(dialog.documentId, dialog.name)
            : await deleteSheetConfirmed(
                dialog.documentId,
                dialog.sheetId,
                dialog.name,
              );
        uiStateStore.setState(closeDialog);
        return result;
      });
    },
    cancelDialog() {
      uiStateStore.setState(closeDialog);
    },

    async retryDocumentSave(documentId) {
      const session = workspace.getDocumentSession(documentId);
      return session === null ? operationOk(undefined) : session.flush();
    },
    retryProjectSave: () => workspace.saveProject(),

    dismissOperationError(id) {
      uiStateStore.setState((state) => dismissOperationError(state, id));
    },
    setNotificationsOpen(open) {
      uiStateStore.setState((state) => setNotificationsOpen(state, open));
    },
  };
}
