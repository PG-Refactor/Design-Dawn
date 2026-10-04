// The Application-layer workspace (docs/architecture.md §9.7, §11): assembles the open
// project and its document sessions on top of the persistence gateway and the store.
// UI-free; it never shows a dialog and never touches UI state.
//
// Concurrency: lifecycle and project-level operations run one at a time on the workspace
// queue. Sheet-level operations run on the owning document session's queue, so they
// cannot interleave with commands or auto-save of that document.
//
// Failure rule (all operations): memory never claims something that is not true on disk.
// When a step fails AFTER an entity was created on disk, the entity stays in memory and
// the affected save state is left dirty with `lastError`, so a retry persists it.

import {
  addDocument,
  moveDocument,
  removeDocument,
  renameProject,
} from "../../domain/project/project";
import { parseDisplayName } from "../../domain/shared/display-name";
import type {
  DocumentId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import type { Store } from "../../shared/store/store";
import {
  createDocumentSession,
  type DocumentSession,
  type DocumentSessionConfig,
} from "../document-session/document-session";
import type { IdGenerator } from "../id-generator";
import {
  failWith,
  fromDomainResult,
  type OperationError,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type { PersistenceGateway } from "../ports/persistence-gateway";
import type { FolderSelection } from "../ports/persistence-types";
import type { Scheduler } from "../ports/scheduler";
import {
  type ApplicationState,
  connectSessionToStore,
  createInitialApplicationState,
  type OpenProjectDocumentEntry,
  type OpenProjectState,
  putDocumentDetails,
  putDocumentSession,
  removeDocumentSession,
  setOpenProject,
  syncSheetEntries,
} from "../state/application-state";
import {
  documentWithoutSheet,
  withSheetAdded,
  withSheetRemoved,
} from "./sheet-structure";
import {
  validateDocumentSnapshot,
  validateProjectSnapshot,
  validateSheetSnapshot,
} from "./snapshot-validation";
import {
  createWorkspaceEvents,
  type WorkspaceEventListener,
  type WorkspaceEvents,
} from "./workspace-events";

// Deleting is destructive and not undoable. The type forces every caller to state that
// the user confirmed it; the confirmation UI itself is not an application concern.
export interface DestructiveConfirmation {
  readonly confirmedByUser: true;
}

export type WorkspaceConfig = DocumentSessionConfig;

export interface WorkspaceOptions {
  readonly gateway: PersistenceGateway;
  readonly scheduler: Scheduler;
  readonly idGenerator: IdGenerator;
  readonly store: Store<ApplicationState>;
  readonly config: WorkspaceConfig;
  readonly events?: WorkspaceEvents;
}

export interface Workspace {
  subscribe(listener: WorkspaceEventListener): () => void;

  selectProjectFolder(): Promise<OperationResult<FolderSelection>>;
  openProject(selectionId: string): Promise<OperationResult<void>>;
  createProject(
    selectionId: string,
    name: string,
  ): Promise<OperationResult<void>>;
  closeProject(): Promise<OperationResult<void>>;

  openDocument(documentId: DocumentId): Promise<OperationResult<void>>;
  closeDocument(documentId: DocumentId): Promise<OperationResult<void>>;
  // The session of an open document (execute / undo / redo / flush), or null.
  getDocumentSession(documentId: DocumentId): DocumentSession | null;

  createDocument(name: string): Promise<OperationResult<DocumentId>>;
  deleteDocument(
    documentId: DocumentId,
    confirmation: DestructiveConfirmation,
  ): Promise<OperationResult<void>>;
  renameProject(name: string): Promise<OperationResult<void>>;
  moveDocument(
    documentId: DocumentId,
    beforeDocumentId: DocumentId | null,
  ): Promise<OperationResult<void>>;
  // Explicit retry of a project save that failed.
  saveProject(): Promise<OperationResult<void>>;

  createSheet(
    documentId: DocumentId,
    name: string,
  ): Promise<OperationResult<SheetId>>;
  deleteSheet(
    documentId: DocumentId,
    sheetId: SheetId,
    confirmation: DestructiveConfirmation,
  ): Promise<OperationResult<void>>;
}

const CLEAN_PROJECT_SAVE = { dirty: false, lastError: null } as const;

function reorderEntries(
  entries: readonly OpenProjectDocumentEntry[],
  order: readonly DocumentId[],
): readonly OpenProjectDocumentEntry[] {
  const position = (entry: OpenProjectDocumentEntry): number => {
    const index = order.indexOf(entry.documentId);
    // Entries the order does not list (load issues) stay behind the listed ones.
    return index < 0 ? order.length : index;
  };
  return [...entries].sort(
    (first, second) => position(first) - position(second),
  );
}

export function createWorkspace(options: WorkspaceOptions): Workspace {
  const { gateway, scheduler, idGenerator, store, config } = options;
  const events = options.events ?? createWorkspaceEvents();
  const sessions = new Map<DocumentId, DocumentSession>();
  const connectSession = connectSessionToStore(store);
  let lifecycleTail: Promise<void> = Promise.resolve();

  function runLifecycle<T>(
    task: () => Promise<OperationResult<T>>,
  ): Promise<OperationResult<T>> {
    const result = lifecycleTail.then(task);
    lifecycleTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function requireProject(): OperationResult<OpenProjectState> {
    const project = store.getState().project;
    return project === null
      ? operationErr("projectNotOpen", "no project is open")
      : operationOk(project);
  }

  function updateProject(
    update: (project: OpenProjectState) => OpenProjectState,
  ): void {
    store.setState((state) =>
      state.project === null
        ? state
        : setOpenProject(state, update(state.project)),
    );
  }

  function markProjectDirty(error: OperationError | null): void {
    updateProject((project) => ({
      ...project,
      save: { dirty: true, lastError: error },
    }));
  }

  // Saves the in-memory project. The save state ends up truthful either way.
  async function saveCurrentProject(): Promise<OperationResult<void>> {
    const project = requireProject();
    if (!project.ok) return project;
    const saved = await gateway.saveProject(
      project.value.projectId,
      project.value.project,
    );
    if (saved.ok) {
      updateProject((current) => ({ ...current, save: CLEAN_PROJECT_SAVE }));
    } else {
      markProjectDirty(saved.error);
    }
    return saved;
  }

  // Memory is updated first and marked dirty; the save then decides whether it stays so.
  function applyProjectChange(
    update: (project: OpenProjectState) => OpenProjectState,
  ): Promise<OperationResult<void>> {
    updateProject((project) => ({
      ...update(project),
      save: { dirty: true, lastError: project.save.lastError },
    }));
    return saveCurrentProject();
  }

  // ---- documents: open / close ----

  function sheetIdsOf(documentId: DocumentId): readonly SheetId[] {
    const state = store.getState();
    const entries = state.documentDetails.get(documentId)?.sheetEntries ?? [];
    const order = state.documents.get(documentId)?.document.sheetOrder ?? [];
    return [...new Set([...order, ...entries.map((entry) => entry.sheetId)])];
  }

  // Removes an open document (session, store state, sibling data) and tells subscribers.
  function detachDocument(documentId: DocumentId): void {
    const sheetIds = sheetIdsOf(documentId);
    sessions.delete(documentId);
    store.setState((state) => removeDocumentSession(state, documentId));
    events.emit({ type: "documentClosed", documentId, sheetIds });
  }

  async function closeOpenDocument(
    documentId: DocumentId,
  ): Promise<OperationResult<void>> {
    const session = sessions.get(documentId);
    if (session === undefined) return operationOk(undefined);
    // Saves inside the session queue, after any in-flight save or command; on failure
    // the session stays open and editable.
    const closed = await session.close();
    if (!closed.ok) return closed;
    detachDocument(documentId);
    const project = requireProject();
    if (!project.ok) return project;
    // After the detach: the Document is already closed in the UI, so a failure here only
    // means Rust may keep serving its assets until the Project is replaced.
    return gateway.closeDocument(project.value.projectId, documentId);
  }

  // Saves everything first (project, then every document) and only then closes, so a
  // failure leaves every document open in normal operation.
  async function closeEverything(): Promise<OperationResult<void>> {
    const project = store.getState().project;
    if (project?.save.dirty === true) {
      const saved = await saveCurrentProject();
      if (!saved.ok) return saved;
    }
    const open = [...sessions.entries()];
    for (const [, session] of open) {
      const flushed = await session.flush();
      if (!flushed.ok) return flushed;
    }
    for (const [documentId] of open) {
      const closed = await closeOpenDocument(documentId);
      if (!closed.ok) return closed;
    }
    return operationOk(undefined);
  }

  function installProject(project: OpenProjectState): void {
    const previous = store.getState().project;
    store.setState({ ...createInitialApplicationState(), project });
    if (previous !== null) {
      events.emit({ type: "projectClosed", projectId: previous.projectId });
    }
  }

  function openOrCreateProject(
    acquire: () => ReturnType<PersistenceGateway["openProject"]>,
  ): Promise<OperationResult<void>> {
    return runLifecycle(async () => {
      // Rust replaces its project session when the new project opens, so the old
      // project's documents must be saved and closed before that happens.
      const closed = await closeEverything();
      if (!closed.ok) return closed;
      const snapshot = await acquire();
      if (!snapshot.ok) return snapshot;
      const valid = validateProjectSnapshot(snapshot.value);
      if (!valid.ok) return valid;
      installProject({
        projectId: valid.value.project.projectId,
        project: valid.value.project,
        documents: valid.value.documents.map((entry) => ({
          documentId: entry.documentId,
          name: entry.name,
          state: entry.state,
        })),
        issues: valid.value.issues,
        save: CLEAN_PROJECT_SAVE,
      });
      return operationOk(undefined);
    });
  }

  function openDocumentStep(
    documentId: DocumentId,
  ): Promise<OperationResult<void>> {
    return runLifecycle(async () => {
      const project = requireProject();
      if (!project.ok) return project;
      if (sessions.has(documentId)) return operationOk(undefined);
      const known = project.value.documents.some(
        (entry) => entry.documentId === documentId,
      );
      if (!known) {
        return operationErr(
          "entityNotFound",
          `document not found: ${documentId}`,
        );
      }
      const loaded = await gateway.loadDocument(
        project.value.projectId,
        documentId,
      );
      if (!loaded.ok) return loaded;
      const valid = validateDocumentSnapshot(loaded.value, documentId);
      if (!valid.ok) return valid;
      const session = createDocumentSession({
        projectId: project.value.projectId,
        document: valid.value.document,
        sheets: valid.value.sheets,
        gateway,
        scheduler,
        config,
        onStateChange: connectSession,
      });
      const sessionState = session.getState();
      sessions.set(documentId, session);
      store.setState((state) =>
        putDocumentDetails(
          putDocumentSession(state, sessionState),
          documentId,
          {
            sheetEntries: syncSheetEntries(
              valid.value.failedSheets,
              sessionState,
            ),
            issues: valid.value.issues,
          },
        ),
      );
      return operationOk(undefined);
    });
  }

  // ---- project-level operations ----

  function createDocumentStep(
    name: string,
  ): Promise<OperationResult<DocumentId>> {
    return runLifecycle(async () => {
      const project = requireProject();
      if (!project.ok) return project;
      const displayName = fromDomainResult(parseDisplayName(name));
      if (!displayName.ok) return failWith(displayName.error);
      const documentId = idGenerator.documentId();
      const created = await gateway.createDocument(
        project.value.projectId,
        documentId,
        displayName.value,
      );
      if (!created.ok) return created;
      const valid = validateDocumentSnapshot(created.value, documentId);
      if (!valid.ok) return valid;
      const ordered = fromDomainResult(
        addDocument(project.value.project, documentId),
      );
      if (!ordered.ok) return failWith(ordered.error);
      // The directory exists now, so it is listed even if saving the order fails.
      const saved = await applyProjectChange((current) => ({
        ...current,
        project: ordered.value,
        documents: [
          ...current.documents,
          { documentId, name: valid.value.document.name, state: "loaded" },
        ],
      }));
      return saved.ok ? operationOk(documentId) : saved;
    });
  }

  function deleteDocumentStep(
    documentId: DocumentId,
  ): Promise<OperationResult<void>> {
    return runLifecycle(async () => {
      const project = requireProject();
      if (!project.ok) return project;
      const entry = project.value.documents.find(
        (candidate) => candidate.documentId === documentId,
      );
      if (entry === undefined) {
        return operationErr(
          "entityNotFound",
          `document not found: ${documentId}`,
        );
      }
      const without = project.value.project.documentOrder.includes(documentId)
        ? fromDomainResult(removeDocument(project.value.project, documentId))
        : operationOk(project.value.project);
      if (!without.ok) return failWith(without.error);
      // Order first: if the process dies before the directory is deleted, an unlisted
      // directory remains (reported on load) instead of a listed one that is gone.
      const saved = await gateway.saveProject(
        project.value.projectId,
        without.value,
      );
      if (!saved.ok) return saved;
      updateProject((current) => ({
        ...current,
        project: without.value,
        documents: current.documents.filter(
          (candidate) => candidate.documentId !== documentId,
        ),
        save: CLEAN_PROJECT_SAVE,
      }));
      const session = sessions.get(documentId);
      if (session !== undefined) {
        // Unsaved edits of a document that is being deleted are meant to be dropped.
        await session.discard();
        detachDocument(documentId);
      }
      const deleted = await gateway.deleteDocument(
        project.value.projectId,
        documentId,
      );
      if (deleted.ok) return deleted;
      // The directory still exists, but the saved order no longer lists it: show it
      // again and keep the project dirty so the order is saved again.
      const restored = fromDomainResult(addDocument(without.value, documentId));
      updateProject((current) => ({
        ...current,
        project: restored.ok ? restored.value : current.project,
        documents: [...current.documents, entry],
        save: { dirty: true, lastError: deleted.error },
      }));
      return deleted;
    });
  }

  function renameProjectStep(name: string): Promise<OperationResult<void>> {
    return runLifecycle(async () => {
      const project = requireProject();
      if (!project.ok) return project;
      const displayName = fromDomainResult(parseDisplayName(name));
      if (!displayName.ok) return failWith(displayName.error);
      const renamed = fromDomainResult(
        renameProject(project.value.project, displayName.value),
      );
      if (!renamed.ok) return failWith(renamed.error);
      return applyProjectChange((current) => ({
        ...current,
        project: renamed.value,
      }));
    });
  }

  function moveDocumentStep(
    documentId: DocumentId,
    beforeDocumentId: DocumentId | null,
  ): Promise<OperationResult<void>> {
    return runLifecycle(async () => {
      const project = requireProject();
      if (!project.ok) return project;
      const moved = fromDomainResult(
        moveDocument(project.value.project, documentId, beforeDocumentId),
      );
      if (!moved.ok) return failWith(moved.error);
      return applyProjectChange((current) => ({
        ...current,
        project: moved.value,
        documents: reorderEntries(current.documents, moved.value.documentOrder),
      }));
    });
  }

  // ---- sheet-level operations (run on the document session's queue) ----

  function requireOpenDocument(
    documentId: DocumentId,
  ): OperationResult<{ projectId: ProjectId; session: DocumentSession }> {
    const project = requireProject();
    if (!project.ok) return project;
    const session = sessions.get(documentId);
    if (session !== undefined) {
      return operationOk({ projectId: project.value.projectId, session });
    }
    const known = project.value.documents.some(
      (entry) => entry.documentId === documentId,
    );
    return known
      ? operationErr("notWritable", `document is not open: ${documentId}`)
      : operationErr("entityNotFound", `document not found: ${documentId}`);
  }

  async function createSheetStep(
    documentId: DocumentId,
    name: string,
  ): Promise<OperationResult<SheetId>> {
    const target = requireOpenDocument(documentId);
    if (!target.ok) return target;
    const displayName = fromDomainResult(parseDisplayName(name));
    if (!displayName.ok) return failWith(displayName.error);
    const sheetId = idGenerator.sheetId();
    const { projectId, session } = target.value;
    return session.runExclusive(async (scope) => {
      const created = await gateway.createSheet(
        projectId,
        documentId,
        sheetId,
        displayName.value,
      );
      if (!created.ok) return created;
      const sheet = validateSheetSnapshot(created.value, sheetId);
      if (!sheet.ok) return sheet;
      // History stays: existing commands never reference a sheet that is only added.
      const applied = scope.applyStructuralChange(
        (data) => withSheetAdded(data, sheet.value),
        { clearHistory: false, markDirty: true },
      );
      if (!applied.ok) return applied;
      // The sheet exists on disk; if this save fails it stays in memory, dirty.
      const saved = await scope.saveDirty();
      return saved.ok ? operationOk(sheetId) : saved;
    });
  }

  async function deleteSheetStep(
    documentId: DocumentId,
    sheetId: SheetId,
  ): Promise<OperationResult<void>> {
    const target = requireOpenDocument(documentId);
    if (!target.ok) return target;
    const { projectId, session } = target.value;
    return session.runExclusive(async (scope) => {
      const data = scope.getData();
      const entries =
        store.getState().documentDetails.get(documentId)?.sheetEntries ?? [];
      const known =
        data.sheets.has(sheetId) ||
        data.document.sheetOrder.includes(sheetId) ||
        entries.some((entry) => entry.sheetId === sheetId);
      if (!known) {
        return operationErr("entityNotFound", `sheet not found: ${sheetId}`);
      }
      // Pending edits of the other sheets are saved first, so nothing unsaved is lost
      // if the process stops between the steps below.
      const flushed = await scope.saveDirty();
      if (!flushed.ok) return flushed;
      const without = documentWithoutSheet(data, sheetId);
      if (!without.ok) return failWith(without.error);
      const orderChanged = without.value !== data.document;
      // Order first, directory second (docs/file-format.md §9). Memory is untouched
      // until the directory is really gone, so a failure here changes nothing.
      if (orderChanged) {
        const saved = await gateway.saveDocument(projectId, without.value);
        if (!saved.ok) return saved;
      }
      const deleted = await gateway.deleteSheet(projectId, documentId, sheetId);
      if (!deleted.ok) {
        if (orderChanged) {
          // The saved order lost the sheet but the directory is still there: write the
          // in-memory order back; when that fails too, leave the document dirty.
          const restored = await gateway.saveDocument(projectId, data.document);
          if (!restored.ok) {
            scope.markDirty({
              documentChanged: true,
              changedSheetIds: [],
              changedContentBlockIds: [],
            });
          }
        }
        return deleted;
      }
      store.setState((state) => {
        const details = state.documentDetails.get(documentId);
        return details === undefined
          ? state
          : putDocumentDetails(state, documentId, {
              ...details,
              sheetEntries: details.sheetEntries.filter(
                (entry) => entry.sheetId !== sheetId,
              ),
            });
      });
      const applied = scope.applyStructuralChange(
        (current) => withSheetRemoved(current, sheetId),
        // The order was saved above; history may reference the removed sheet.
        { clearHistory: true, markDirty: false },
      );
      if (!applied.ok) return applied;
      events.emit({ type: "sheetDeleted", documentId, sheetId });
      return operationOk(undefined);
    });
  }

  return {
    subscribe: (listener) => events.subscribe(listener),
    selectProjectFolder: () => gateway.selectProjectFolder(),
    openProject: (selectionId) =>
      openOrCreateProject(() => gateway.openProject(selectionId)),
    createProject(selectionId, name) {
      const displayName = fromDomainResult(parseDisplayName(name));
      // Validated before anything is closed.
      if (!displayName.ok) return Promise.resolve(failWith(displayName.error));
      return openOrCreateProject(() =>
        gateway.createProject(selectionId, displayName.value),
      );
    },
    closeProject: () =>
      runLifecycle(async () => {
        const project = store.getState().project;
        if (project === null) return operationOk(undefined);
        const closed = await closeEverything();
        if (!closed.ok) return closed;
        store.setState(createInitialApplicationState());
        events.emit({ type: "projectClosed", projectId: project.projectId });
        return operationOk(undefined);
      }),
    openDocument: openDocumentStep,
    closeDocument: (documentId) =>
      runLifecycle(() => closeOpenDocument(documentId)),
    getDocumentSession: (documentId) => sessions.get(documentId) ?? null,
    createDocument: createDocumentStep,
    deleteDocument: (documentId) => deleteDocumentStep(documentId),
    renameProject: renameProjectStep,
    moveDocument: moveDocumentStep,
    saveProject: () => runLifecycle(saveCurrentProject),
    createSheet: createSheetStep,
    deleteSheet: (documentId, sheetId) => deleteSheetStep(documentId, sheetId),
  };
}
