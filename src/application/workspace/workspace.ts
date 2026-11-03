// The Application-layer workspace: assembles the open
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

import { renameProject } from "../../domain/project/project";
import { parseDisplayName } from "../../domain/shared/display-name";
import type {
  DocumentId,
  EntryId,
  FolderId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import type { Store } from "../../shared/store/store";
import {
  createDocumentSession,
  type DocumentSession,
  type DocumentSessionConfig,
  type DocumentSessionSeed,
} from "../document-session/document-session";
import {
  decodeDocumentTransfer,
  encodeDocumentTransfer,
} from "../document-session/document-transfer";
import type { IdGenerator } from "../id-generator";
import type { AutoSavePolicy } from "../ports/auto-save-policy";
import type {
  DocumentWindowGateway,
  DocumentWindowTarget,
  ProjectWindowInfo,
} from "../ports/document-window-gateway";
import {
  failWith,
  fromDomainResult,
  type OperationError,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type { PersistenceGateway } from "../ports/persistence-gateway";
import type {
  FolderSelection,
  OpenInNewWindowResult,
} from "../ports/persistence-types";
import type { Scheduler } from "../ports/scheduler";
import {
  type ApplicationState,
  connectSessionToStore,
  createInitialApplicationState,
  type OpenDocumentDetails,
  type OpenProjectState,
  putDocumentDetails,
  putDocumentSession,
  removeDocumentSession,
  setOpenProject,
  syncSheetEntries,
} from "../state/application-state";
import {
  CLEAN_SAVE,
  documentsUnder,
  findProjectEntry,
  orderWithout,
  type ParentId,
  requireWritableParent,
  withAppendedChild,
  withChildOrder,
  withParentSave,
} from "./project-entries";
import { createProjectTreeSteps } from "./project-tree-steps";
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
  // Defaults to always enabled. Switching it on resumes auto-save of every open document.
  readonly autoSavePolicy?: AutoSavePolicy;
  readonly idGenerator: IdGenerator;
  readonly store: Store<ApplicationState>;
  readonly config: WorkspaceConfig;
  readonly events?: WorkspaceEvents;
  // The other windows of the Project (moving Documents between them). Without it, moving
  // is `notWritable` and nothing else changes.
  readonly windows?: DocumentWindowGateway;
}

// `discardChanges` closes WITHOUT saving: only after the user explicitly chose to give up
// the unsaved changes (auto-save off).
export interface CloseOptions {
  readonly discardChanges?: boolean;
}

export interface Workspace {
  subscribe(listener: WorkspaceEventListener): () => void;

  selectProjectFolder(): Promise<OperationResult<FolderSelection>>;
  // Closing the previous Project (when one is open) honours `options`.
  openProject(
    selectionId: string,
    options?: CloseOptions,
  ): Promise<OperationResult<void>>;
  createProject(
    selectionId: string,
    name: string,
    options?: CloseOptions,
  ): Promise<OperationResult<void>>;
  // Reads the open Project again from disk: like opening it afresh, so the open Documents
  // are saved and closed first (`options` as for `openProject`) and the Project and its
  // tree are replaced by what is on disk. `projectNotOpen` without a Project.
  reloadProject(options?: CloseOptions): Promise<OperationResult<void>>;
  // Installs the Project that a launch argument (`.dawn`) or an "open in a new window"
  // asked for, which Rust has already opened, and resolves to the Document to open (null
  // when nothing was requested, or for a Project folder, which names no Document). It does
  // not open the Document itself: the UI layer also activates it.
  openLaunchRequest(): Promise<OperationResult<DocumentId | null>>;
  // Opens the selected folder's Project in a window of its own (or brings forward the
  // window that has it). Nothing changes in this window.
  openProjectInNewWindow(
    selectionId: string,
  ): Promise<OperationResult<OpenInNewWindowResult>>;
  closeProject(options?: CloseOptions): Promise<OperationResult<void>>;

  openDocument(documentId: DocumentId): Promise<OperationResult<void>>;
  closeDocument(
    documentId: DocumentId,
    options?: CloseOptions,
  ): Promise<OperationResult<void>>;
  // The session of an open document (execute / undo / redo / flush), or null.
  getDocumentSession(documentId: DocumentId): DocumentSession | null;

  // `parentFolderId` null (the default) creates it directly under the Project; otherwise
  // inside that loaded Folder. Appended to the parent's order.
  createDocument(
    name: string,
    parentFolderId?: FolderId | null,
  ): Promise<OperationResult<DocumentId>>;
  createFolder(
    parentFolderId: FolderId | null,
    name: string,
  ): Promise<OperationResult<FolderId>>;
  renameFolder(
    folderId: FolderId,
    name: string,
  ): Promise<OperationResult<void>>;
  // Reorder among the siblings of the same parent (Project or Folder), directly before
  // `beforeEntryId`, or last when null. Saves the parent's file; not undoable.
  moveFolder(
    folderId: FolderId,
    beforeEntryId: EntryId | null,
  ): Promise<OperationResult<void>>;
  // Moves a Document / Folder into another loaded Folder or the Project root, appended to
  // the target's order. Open Documents (and Folders holding some) move too and stay open:
  // Rust rebases the session paths. Rejected with `invalidMove` for a Folder moved into
  // itself / a descendant. Unsaved changes are not flushed here; see `flushDocuments`.
  moveEntry(
    entryId: EntryId,
    targetParentFolderId: FolderId | null,
  ): Promise<OperationResult<void>>;
  // Only an empty Folder (`folderNotEmpty` otherwise).
  deleteFolder(
    folderId: FolderId,
    confirmation: DestructiveConfirmation,
  ): Promise<OperationResult<void>>;
  // Explicit retry of a folder save that failed.
  saveFolder(folderId: FolderId): Promise<OperationResult<void>>;
  deleteDocument(
    documentId: DocumentId,
    confirmation: DestructiveConfirmation,
  ): Promise<OperationResult<void>>;
  renameProject(name: string): Promise<OperationResult<void>>;
  moveDocument(
    documentId: DocumentId,
    beforeEntryId: EntryId | null,
  ): Promise<OperationResult<void>>;
  // Explicit retry of a project save that failed.
  saveProject(): Promise<OperationResult<void>>;
  // The open Documents a move of `entryId` would carry along: the Document itself, or the
  // open Documents at any depth inside the Folder. Empty for an unknown entry.
  openDocumentsUnder(entryId: EntryId): readonly DocumentId[];
  // Saves the pending changes of just these open Documents (not the project, folders or
  // other Documents). Tries all of them; returns the first error. Ids that are not open
  // are skipped.
  flushDocuments(
    documentIds: readonly DocumentId[],
  ): Promise<OperationResult<void>>;
  // Saves everything that is unsaved (the project, then every open document) without
  // closing anything. Tries all of it; returns the first error.
  saveAll(): Promise<OperationResult<void>>;

  // Moves an open Document to another window WITHOUT saving: its unsaved changes and
  // undo / redo history go with it, and this window drops it. When the move fails the
  // Document stays here as it was. Editor drafts must be committed by the caller first.
  moveDocumentToWindow(
    documentId: DocumentId,
    target: DocumentWindowTarget,
  ): Promise<OperationResult<void>>;
  // Opens a Document another window handed to this one, as it was there (unsaved changes
  // and history included). Resolves to the Document's id.
  receiveDocument(transferId: string): Promise<OperationResult<DocumentId>>;
  // Another window changed the tree or a Document's name: reads the Project again (without
  // touching the session) and takes over the names; a Document window also takes the tree.
  refreshProjectTree(): Promise<OperationResult<void>>;
  // The windows of this window's Project (what a Document can move to).
  listProjectWindows(): Promise<OperationResult<readonly ProjectWindowInfo[]>>;
  // Where a Document dropped at a screen point (a tab dragged out of the window) goes:
  // the other window of the Project under it, or a new window placed there.
  dropTargetAt(
    screenX: number,
    screenY: number,
  ): Promise<OperationResult<DocumentWindowTarget>>;

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

export function createWorkspace(options: WorkspaceOptions): Workspace {
  const { gateway, scheduler, idGenerator, store, config, autoSavePolicy } =
    options;
  const { windows } = options;
  // Hand-overs already taken, by id. The same hand-over can be announced again (a window
  // that subscribes while starting hears about the one its start-up request carries), and
  // taking it a second time must not count as a failure.
  const takenTransfers = new Map<string, DocumentId>();
  const events = options.events ?? createWorkspaceEvents();
  const sessions = new Map<DocumentId, DocumentSession>();
  const connectSession = connectSessionToStore(store);
  let lifecycleTail: Promise<void> = Promise.resolve();

  // Lives as long as the app: the workspace has no teardown and the policy never outlives it.
  autoSavePolicy?.subscribe((enabled) => {
    if (!enabled) return;
    for (const session of sessions.values()) session.resumeAutoSave();
  });

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
      updateProject((current) => ({ ...current, save: CLEAN_SAVE }));
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

  const treeSteps = createProjectTreeSteps({
    gateway,
    idGenerator,
    requireProject,
    updateProject,
    saveCurrentProject,
  });

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
    discardChanges = false,
  ): Promise<OperationResult<void>> {
    const session = sessions.get(documentId);
    if (session === undefined) return operationOk(undefined);
    if (discardChanges) {
      // The user chose to give the changes up: nothing is written, timers stop, history
      // is dropped.
      await session.discard();
    } else {
      // Saves inside the session queue, after any in-flight save or command; on failure
      // the session stays open and editable.
      const closed = await session.close();
      if (!closed.ok) return closed;
    }
    detachDocument(documentId);
    const project = requireProject();
    if (!project.ok) return project;
    // After the detach: the Document is already closed in the UI, so a failure here only
    // means Rust may keep serving its assets until the Project is replaced.
    return gateway.closeDocument(project.value.projectId, documentId);
  }

  // Explicit save of everything unsaved. Unlike closeEverything it does not stop at the
  // first failure: nothing is closed afterwards, so saving what can be saved is strictly
  // better, and every failure stays visible in its own save state.
  async function saveEverything(): Promise<OperationResult<void>> {
    let firstFailure: OperationResult<void> | null = null;
    if (store.getState().project?.save.dirty === true) {
      const saved = await saveCurrentProject();
      if (!saved.ok) firstFailure = saved;
    }
    const foldersSaved = await treeSteps.saveDirtyFolders(false);
    if (!foldersSaved.ok) firstFailure ??= foldersSaved;
    for (const session of [...sessions.values()]) {
      const flushed = await session.flush();
      if (!flushed.ok && firstFailure === null) firstFailure = flushed;
    }
    return firstFailure ?? operationOk(undefined);
  }

  async function flushOpenDocuments(
    documentIds: readonly DocumentId[],
  ): Promise<OperationResult<void>> {
    let firstFailure: OperationResult<void> | null = null;
    for (const documentId of documentIds) {
      const flushed = await sessions.get(documentId)?.flush();
      if (flushed !== undefined && !flushed.ok && firstFailure === null) {
        firstFailure = flushed;
      }
    }
    return firstFailure ?? operationOk(undefined);
  }

  function openDocumentsUnderEntry(entryId: EntryId): readonly DocumentId[] {
    const project = store.getState().project;
    const found = project === null ? null : findProjectEntry(project, entryId);
    if (project === null || found === null) return [];
    const documentIds =
      found.kind === "folder"
        ? documentsUnder(project, found.entry.folderId)
        : [found.entry.documentId];
    return documentIds.filter((documentId) => sessions.has(documentId));
  }

  // Saves everything first (project, then every document) and only then closes, so a
  // failure leaves every document open in normal operation.
  // With `discardChanges` nothing is saved: the dirty Project / Folder state disappears with
  // the state reset that follows, and every session is closed without saving.
  async function closeEverything(
    discardChanges: boolean,
  ): Promise<OperationResult<void>> {
    if (discardChanges) {
      for (const documentId of [...sessions.keys()]) {
        const closed = await closeOpenDocument(documentId, true);
        if (!closed.ok) return closed;
      }
      return operationOk(undefined);
    }
    const project = store.getState().project;
    if (project?.save.dirty === true) {
      const saved = await saveCurrentProject();
      if (!saved.ok) return saved;
    }
    const foldersSaved = await treeSteps.saveDirtyFolders(true);
    if (!foldersSaved.ok) return foldersSaved;
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
    discardChanges: boolean,
  ): Promise<OperationResult<void>> {
    return runLifecycle(async () => {
      // Rust replaces its project session when the new project opens, so the old
      // project's documents must be saved and closed before that happens.
      const closed = await closeEverything(discardChanges);
      if (!closed.ok) return closed;
      const snapshot = await acquire();
      if (!snapshot.ok) return snapshot;
      const valid = validateProjectSnapshot(snapshot.value);
      if (!valid.ok) return valid;
      installProject({
        projectId: valid.value.project.projectId,
        project: valid.value.project,
        sessionGeneration: valid.value.sessionGeneration,
        folders: valid.value.folders.map((entry) => ({
          folderId: entry.folderId,
          name: entry.name,
          parentFolderId: entry.parentFolderId,
          childOrder: entry.childOrder,
          state: entry.state,
          save: CLEAN_SAVE,
        })),
        documents: valid.value.documents.map((entry) => ({
          documentId: entry.documentId,
          parentFolderId: entry.parentFolderId,
          name: entry.name,
          state: entry.state,
        })),
        issues: valid.value.issues,
        save: CLEAN_SAVE,
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
        autoSavePolicy,
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

  // ---- documents: moving between windows ----

  // Puts a session made from a hand-over into the workspace, like a freshly opened one.
  function adoptSession(
    projectId: ProjectId,
    seed: DocumentSessionSeed,
    details: { readonly issues: OpenDocumentDetails["issues"] },
  ): void {
    const documentId = seed.document.documentId;
    const session = createDocumentSession({
      projectId,
      document: seed.document,
      sheets: seed.sheets,
      seed,
      gateway,
      scheduler,
      autoSavePolicy,
      config,
      onStateChange: connectSession,
    });
    const sessionState = session.getState();
    sessions.set(documentId, session);
    store.setState((state) =>
      putDocumentDetails(putDocumentSession(state, sessionState), documentId, {
        sheetEntries: syncSheetEntries([], sessionState),
        issues: details.issues,
      }),
    );
  }

  function moveDocumentStep(
    documentId: DocumentId,
    target: DocumentWindowTarget,
  ): Promise<OperationResult<void>> {
    return runLifecycle(async () => {
      if (windows === undefined) {
        return operationErr("notWritable", "no other windows to move to");
      }
      const project = requireProject();
      if (!project.ok) return project;
      const session = sessions.get(documentId);
      if (session === undefined) {
        return operationErr(
          "notWritable",
          `document ${documentId} is not open`,
        );
      }
      const issues =
        store.getState().documentDetails.get(documentId)?.issues ?? [];
      const handed = await session.handOver();
      if (!handed.ok) return handed;
      const payload = encodeDocumentTransfer({
        projectId: project.value.projectId,
        sessionGeneration: project.value.sessionGeneration,
        documentId,
        seed: handed.value,
      });
      const moved = await windows.transferDocument(
        project.value.projectId,
        documentId,
        payload,
        target,
      );
      if (!moved.ok) {
        // Nothing left: the Document goes on here exactly as it was.
        adoptSession(project.value.projectId, handed.value, { issues });
        return moved;
      }
      // Not `closeDocument` in Rust: the Document stays open there, held by its new window.
      detachDocument(documentId);
      return operationOk(undefined);
    });
  }

  function receiveDocumentStep(
    transferId: string,
  ): Promise<OperationResult<DocumentId>> {
    return runLifecycle(async () => {
      if (windows === undefined) {
        return operationErr("invalidDocumentTransfer", "no window gateway");
      }
      const already = takenTransfers.get(transferId);
      if (already !== undefined) return operationOk(already);
      const project = requireProject();
      if (!project.ok) return project;
      const taken = await windows.takeDocumentTransfer(transferId);
      if (!taken.ok) return taken;
      const decoded = decodeDocumentTransfer(taken.value);
      if (!decoded.ok) return decoded;
      const transfer = decoded.value;
      // A Document read under another Project, or under an older read of it, would save
      // over files this window does not know the state of.
      if (
        transfer.projectId !== project.value.projectId ||
        transfer.sessionGeneration !== project.value.sessionGeneration
      ) {
        return operationErr(
          "invalidDocumentTransfer",
          "the document belongs to another read of the project",
        );
      }
      if (sessions.has(transfer.documentId)) {
        return operationErr(
          "invalidDocumentTransfer",
          `document ${transfer.documentId} is already open here`,
        );
      }
      adoptSession(project.value.projectId, transfer.seed, { issues: [] });
      takenTransfers.set(transferId, transfer.documentId);
      return operationOk(transfer.documentId);
    });
  }

  function refreshProjectTreeStep(): Promise<OperationResult<void>> {
    return runLifecycle(async () => {
      if (windows === undefined) return operationOk(undefined);
      const project = requireProject();
      if (!project.ok) return project;
      const read = await windows.getProjectSnapshot(project.value.projectId);
      if (!read.ok) return read;
      const valid = validateProjectSnapshot(read.value);
      if (!valid.ok) return valid;
      const fresh = valid.value;
      if (store.getState().windowRole === "document") {
        // Nothing here changes the tree: take it as it is now.
        updateProject((current) => ({
          ...current,
          project: fresh.project,
          folders: fresh.folders.map((entry) => ({
            ...entry,
            save: CLEAN_SAVE,
          })),
          documents: fresh.documents,
        }));
        return operationOk(undefined);
      }
      // The Project window owns its tree; only names changed elsewhere are taken over
      // (a Document renamed in the window that holds it). Open Documents name themselves.
      const names = new Map(
        fresh.documents.map((entry) => [entry.documentId, entry.name]),
      );
      updateProject((current) => ({
        ...current,
        documents: current.documents.map((entry) => {
          const name = names.get(entry.documentId);
          return name === undefined ||
            name === entry.name ||
            sessions.has(entry.documentId)
            ? entry
            : { ...entry, name };
        }),
      }));
      return operationOk(undefined);
    });
  }

  // ---- project-level operations ----

  function createDocumentStep(
    name: string,
    parentFolderId: ParentId,
  ): Promise<OperationResult<DocumentId>> {
    return runLifecycle(async () => {
      const project = requireProject();
      if (!project.ok) return project;
      const parent = requireWritableParent(project.value, parentFolderId);
      if (!parent.ok) return parent;
      const displayName = fromDomainResult(parseDisplayName(name));
      if (!displayName.ok) return failWith(displayName.error);
      const documentId = idGenerator.documentId();
      const created = await gateway.createDocument(
        project.value.projectId,
        documentId,
        displayName.value,
        parentFolderId,
      );
      if (!created.ok) return created;
      const valid = validateDocumentSnapshot(created.value, documentId);
      if (!valid.ok) return valid;
      const current = requireProject();
      if (!current.ok) return current;
      const listed = withAppendedChild(
        {
          ...current.value,
          documents: [
            ...current.value.documents,
            {
              documentId,
              parentFolderId,
              name: valid.value.document.name,
              state: "loaded",
            },
          ],
        },
        parentFolderId,
        documentId,
      );
      if (!listed.ok) return failWith(listed.error);
      // The directory exists now, so it is listed even if saving the order fails.
      updateProject(() => listed.value);
      const saved = await treeSteps.saveParent(parentFolderId);
      return saved.ok ? operationOk(documentId) : saved;
    });
  }

  function deleteDocumentStep(
    documentId: DocumentId,
  ): Promise<OperationResult<void>> {
    return runLifecycle(async () => {
      const project = requireProject();
      if (!project.ok) return project;
      const found = findProjectEntry(project.value, documentId);
      if (found === null || found.kind !== "document") {
        return operationErr(
          "entityNotFound",
          `document not found: ${documentId}`,
        );
      }
      const entry = found.entry;
      const parentId = entry.parentFolderId;
      const without = orderWithout(project.value, parentId, documentId);
      if (!without.ok) return failWith(without.error);
      // Order first: if the process dies before the directory is deleted, an unlisted
      // directory remains (reported on load) instead of a listed one that is gone. A
      // Document that its parent does not list has nothing to remove.
      if (without.value !== null) {
        const saved = await treeSteps.saveOrderOf(parentId, without.value);
        if (!saved.ok) return saved;
      }
      updateProject((current) => {
        const removed = {
          ...current,
          documents: current.documents.filter(
            (candidate) => candidate.documentId !== documentId,
          ),
        };
        if (without.value === null) return removed;
        return withParentSave(
          withChildOrder(removed, parentId, without.value),
          parentId,
          CLEAN_SAVE,
        );
      });
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
      // again and keep the parent dirty so the order is saved again.
      updateProject((current) => {
        const restored = {
          ...current,
          documents: [...current.documents, entry],
        };
        if (without.value === null) return restored;
        // Appended: the original position is not worth a second order of truth.
        const listed = withAppendedChild(restored, parentId, documentId);
        return withParentSave(listed.ok ? listed.value : restored, parentId, {
          dirty: true,
          lastError: deleted.error,
        });
      });
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
      // Order first, directory second. Memory is untouched
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
    openProject: (selectionId, options) =>
      openOrCreateProject(
        () => gateway.openProject(selectionId),
        options?.discardChanges === true,
      ),
    reloadProject(options) {
      const project = requireProject();
      if (!project.ok) return Promise.resolve(project);
      return openOrCreateProject(
        () => gateway.reloadProject(project.value.projectId),
        options?.discardChanges === true,
      );
    },
    createProject(selectionId, name, options) {
      const displayName = fromDomainResult(parseDisplayName(name));
      // Validated before anything is closed.
      if (!displayName.ok) return Promise.resolve(failWith(displayName.error));
      return openOrCreateProject(
        () => gateway.createProject(selectionId, displayName.value),
        options?.discardChanges === true,
      );
    },
    async openLaunchRequest() {
      // Taken outside the lifecycle queue: with nothing pending there is nothing to
      // serialise, and the open itself below goes through it like any other open.
      const taken = await gateway.takeOpenRequest();
      if (!taken.ok) return taken;
      const request = taken.value;
      if (request === null) return operationOk(null);
      const installed = await openOrCreateProject(
        () => Promise.resolve(operationOk(request.snapshot)),
        false,
      );
      if (!installed.ok) return installed;
      if (request.transferId === null) return operationOk(request.documentId);
      // A window made for a Document moved out of another window: Documents only.
      store.setState((state) => ({ ...state, windowRole: "document" }));
      return receiveDocumentStep(request.transferId);
    },
    openProjectInNewWindow: (selectionId) =>
      gateway.openProjectInNewWindow(selectionId),
    closeProject: (options) =>
      runLifecycle(async () => {
        const project = store.getState().project;
        if (project === null) return operationOk(undefined);
        const closed = await closeEverything(options?.discardChanges === true);
        if (!closed.ok) return closed;
        // After the documents were saved and closed; a replacing open needs no call
        // because Rust unbinds the previous Project itself when the new one is bound.
        const released = await gateway.closeProject();
        if (!released.ok) return released;
        store.setState(createInitialApplicationState());
        events.emit({ type: "projectClosed", projectId: project.projectId });
        return operationOk(undefined);
      }),
    openDocument: openDocumentStep,
    closeDocument: (documentId, options) =>
      runLifecycle(() =>
        closeOpenDocument(documentId, options?.discardChanges === true),
      ),
    getDocumentSession: (documentId) => sessions.get(documentId) ?? null,
    createDocument: (name, parentFolderId = null) =>
      createDocumentStep(name, parentFolderId),
    createFolder: (parentFolderId, name) =>
      runLifecycle(() => treeSteps.createFolder(parentFolderId, name)),
    renameFolder: (folderId, name) =>
      runLifecycle(() => treeSteps.renameFolder(folderId, name)),
    moveFolder: (folderId, beforeEntryId) =>
      runLifecycle(() => treeSteps.reorder("folder", folderId, beforeEntryId)),
    moveEntry: (entryId, targetParentFolderId) =>
      runLifecycle(() => treeSteps.moveEntry(entryId, targetParentFolderId)),
    deleteFolder: (folderId) =>
      runLifecycle(() => treeSteps.deleteFolder(folderId)),
    saveFolder: (folderId) =>
      runLifecycle(() => treeSteps.saveFolder(folderId)),
    deleteDocument: (documentId) => deleteDocumentStep(documentId),
    renameProject: renameProjectStep,
    moveDocument: (documentId, beforeEntryId) =>
      runLifecycle(() =>
        treeSteps.reorder("document", documentId, beforeEntryId),
      ),
    saveProject: () => runLifecycle(saveCurrentProject),
    openDocumentsUnder: openDocumentsUnderEntry,
    flushDocuments: (documentIds) =>
      runLifecycle(() => flushOpenDocuments(documentIds)),
    saveAll: () => runLifecycle(saveEverything),
    moveDocumentToWindow: moveDocumentStep,
    receiveDocument: receiveDocumentStep,
    refreshProjectTree: refreshProjectTreeStep,
    async dropTargetAt(screenX, screenY) {
      const project = requireProject();
      if (!project.ok) return project;
      if (windows === undefined) {
        return operationOk({ kind: "newWindow", screenX, screenY });
      }
      const found = await windows.projectWindowAt(
        project.value.projectId,
        screenX,
        screenY,
      );
      if (!found.ok) return found;
      return operationOk(
        found.value === null
          ? { kind: "newWindow", screenX, screenY }
          : { kind: "window", label: found.value },
      );
    },
    async listProjectWindows() {
      const project = requireProject();
      if (!project.ok) return project;
      if (windows === undefined) return operationOk([]);
      return windows.listProjectWindows(project.value.projectId);
    },
    createSheet: createSheetStep,
    deleteSheet: (documentId, sheetId) => deleteSheetStep(documentId, sheetId),
  };
}
