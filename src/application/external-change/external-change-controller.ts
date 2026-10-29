// What the app does when Project files changed outside it (docs/architecture.md §14.7–§14.9).
// Rust reports what changed (a pushed notice, or the full comparison `check`); this decides
// per Document: read it again by itself when nothing is unsaved and everything that changed
// can be read, otherwise stop saving that Document and let the user choose (reload / keep
// the current content / overwrite). UI-free: showing the choices and the notifications is the
// UI's job (`features/external-change`); reading a Document or the Project again is injected
// because it also restores what the user was looking at (tabs, active sheet).

import { isTextBlockType } from "../../domain/block/block-type";
import type { DocumentId, ProjectId } from "../../domain/shared/entity-id";
import { createStore, type Store } from "../../shared/store/store";
import type { DocumentSession } from "../document-session/document-session";
import type { ProjectFilesNotice } from "../ports/app-request-source";
import {
  type OperationError,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type { PersistenceGateway } from "../ports/persistence-gateway";
import type { ChangedFile, ExternalChanges } from "../ports/persistence-types";
import type { ApplicationStore } from "../state/application-state";
import {
  hasUnsavedDocumentChanges,
  hasUnsavedProjectChanges,
} from "../state/unsaved-changes";

// "conflict": waiting for the user's choice. "kept": the user chose to keep the content in
// memory; saving stays stopped and the Document stays editable.
export type ConflictStatus = "conflict" | "kept";

export interface DocumentConflict {
  readonly documentId: DocumentId;
  // Document-root-relative; later changes are merged in (the newest state of a path wins).
  readonly files: readonly ChangedFile[];
  readonly status: ConflictStatus;
}

// Project-level files (`project.json`, `folder.json`) or the set of Documents / Folders
// changed. Reading the Project again is the only way to take those in.
export interface ProjectConflict {
  readonly structure: boolean;
  // Project-root-relative.
  readonly files: readonly ChangedFile[];
  readonly status: ConflictStatus;
}

export interface ExternalChangeState {
  // In the order they were detected; the UI asks about the first "conflict" one.
  readonly conflicts: readonly DocumentConflict[];
  readonly projectConflict: ProjectConflict | null;
}

export type ConflictTarget =
  | { readonly kind: "document"; readonly documentId: DocumentId }
  | { readonly kind: "project" };

export type ExternalChangeEvent =
  // Read again without asking (nothing was unsaved).
  | { readonly type: "reloaded"; readonly target: ConflictTarget }
  | {
      readonly type: "reloadFailed";
      readonly target: ConflictTarget;
      readonly error: OperationError;
    }
  // The file watcher is not running for this Project: external changes are only found when
  // the window is focused again. Reported once per read of the Project.
  | { readonly type: "watchUnavailable" }
  // Rust told us something changed under the Project (also when nothing needs reloading):
  // the Git status is stale.
  | { readonly type: "projectFilesActivity" }
  | { readonly type: "checkFailed"; readonly error: OperationError };

export interface ExternalChangeReloader {
  // Closes the Document without saving and opens it again from disk, restoring the view.
  document(documentId: DocumentId): Promise<OperationResult<void>>;
  // Closes every Document without saving, reads the Project again, reopens the Documents.
  project(): Promise<OperationResult<void>>;
}

export interface ExternalChangeControllerOptions {
  readonly gateway: Pick<
    PersistenceGateway,
    "checkExternalChanges" | "acceptDiskState" | "restoreBlockContent"
  >;
  readonly applicationStore: ApplicationStore;
  readonly getDocumentSession: (
    documentId: DocumentId,
  ) => Pick<DocumentSession, "suspendSaving" | "resumeSaving" | "flush"> | null;
  // Text still being typed that is not a command yet (the UI's draft registry).
  readonly hasPendingDraft: (documentIds: readonly DocumentId[]) => boolean;
  readonly reload: ExternalChangeReloader;
  // Saves everything unsaved (commits drafts first); used after overwriting the Project level.
  readonly saveAll: () => Promise<OperationResult<void>>;
  // True while something else rewrites or reloads files (a Git Pull / Discard, a reload).
  // Changes that arrive meanwhile are compared again once it ends (`resume`).
  readonly isBlocked: () => boolean;
  readonly onEvent: (event: ExternalChangeEvent) => void;
}

export interface ExternalChangeController {
  readonly store: Store<ExternalChangeState>;
  // The full comparison with the disk; what the window does when it regains focus.
  check(): Promise<void>;
  // A change notice that Rust pushed.
  handleNotice(notice: ProjectFilesNotice): Promise<void>;
  // Called when whatever blocked ends: compares again if something arrived meanwhile.
  resume(): Promise<void>;
  // Keep what is in memory; saving stays stopped.
  keepCurrent(target: ConflictTarget): void;
  // Take the disk's content in. The caller has already asked about unsaved changes.
  reload(target: ConflictTarget): Promise<OperationResult<void>>;
  // Write the content in memory over what is on disk, then save.
  overwrite(target: ConflictTarget): Promise<OperationResult<void>>;
}

const EMPTY_STATE: ExternalChangeState = {
  conflicts: [],
  projectConflict: null,
};

const CONFLICT_ERROR: OperationError = {
  kind: "externalConflict",
  detail: "files changed outside the app",
};

function mergeFiles(
  known: readonly ChangedFile[],
  incoming: readonly ChangedFile[],
): readonly ChangedFile[] {
  const byPath = new Map(known.map((file) => [file.path, file]));
  for (const file of incoming) byPath.set(file.path, file);
  return [...byPath.values()];
}

export function createExternalChangeController(
  options: ExternalChangeControllerOptions,
): ExternalChangeController {
  const { gateway, applicationStore } = options;
  const store = createStore<ExternalChangeState>(EMPTY_STATE);
  let queueTail: Promise<unknown> = Promise.resolve();
  let recheckPending = false;
  let trackedRead: string | null = null;
  let watchUnavailableReported = false;

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = queueTail.then(task);
    queueTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function currentProject() {
    return applicationStore.getState().project;
  }

  function readKey(): string | null {
    const project = currentProject();
    return project === null
      ? null
      : `${project.projectId}:${project.sessionGeneration}`;
  }

  // A conflict belongs to one read of the Project and to a Document that is still open.
  function syncWithApplication(): void {
    const key = readKey();
    if (key !== trackedRead) {
      trackedRead = key;
      watchUnavailableReported = false;
      recheckPending = false;
      store.setState(EMPTY_STATE);
      return;
    }
    const open = applicationStore.getState().documents;
    const current = store.getState();
    if (current.conflicts.every((entry) => open.has(entry.documentId))) return;
    store.setState({
      ...current,
      conflicts: current.conflicts.filter((entry) =>
        open.has(entry.documentId),
      ),
    });
  }
  trackedRead = readKey();
  applicationStore.subscribe(syncWithApplication);

  function setDocumentConflict(conflict: DocumentConflict): void {
    store.setState((state) => {
      const exists = state.conflicts.some(
        (entry) => entry.documentId === conflict.documentId,
      );
      return {
        ...state,
        conflicts: exists
          ? state.conflicts.map((entry) =>
              entry.documentId === conflict.documentId ? conflict : entry,
            )
          : [...state.conflicts, conflict],
      };
    });
  }

  function removeDocumentConflict(documentId: DocumentId): void {
    store.setState((state) => ({
      ...state,
      conflicts: state.conflicts.filter(
        (entry) => entry.documentId !== documentId,
      ),
    }));
  }

  async function reloadDocumentBy(
    documentId: DocumentId,
  ): Promise<OperationResult<void>> {
    const target: ConflictTarget = { kind: "document", documentId };
    const reloaded = await options.reload.document(documentId);
    if (reloaded.ok) {
      removeDocumentConflict(documentId);
      options.onEvent({ type: "reloaded", target });
    } else {
      options.onEvent({ type: "reloadFailed", target, error: reloaded.error });
    }
    return reloaded;
  }

  async function reloadProjectBy(): Promise<OperationResult<void>> {
    const target: ConflictTarget = { kind: "project" };
    const reloaded = await options.reload.project();
    if (reloaded.ok) {
      // The reload replaced the read of the Project; the state was reset with it.
      options.onEvent({ type: "reloaded", target });
    } else {
      options.onEvent({ type: "reloadFailed", target, error: reloaded.error });
    }
    return reloaded;
  }

  function anythingUnsaved(): boolean {
    const state = applicationStore.getState();
    return (
      hasUnsavedProjectChanges(state) ||
      options.hasPendingDraft([...state.documents.keys()])
    );
  }

  async function process(changes: ExternalChanges): Promise<void> {
    const project = currentProject();
    if (project === null) return;
    // A notice made for an earlier read of the Project describes files read again since.
    if (changes.sessionGeneration !== project.sessionGeneration) return;
    if (!changes.watching && !watchUnavailableReported) {
      watchUnavailableReported = true;
      options.onEvent({ type: "watchUnavailable" });
    }
    options.onEvent({ type: "projectFilesActivity" });
    if (options.isBlocked()) {
      recheckPending = true;
      return;
    }

    const projectChanged =
      changes.project.structure || changes.project.files.length > 0;
    if (projectChanged) {
      const existing = store.getState().projectConflict;
      if (existing !== null) {
        store.setState((state) => ({
          ...state,
          projectConflict: {
            structure: existing.structure || changes.project.structure,
            files: mergeFiles(existing.files, changes.project.files),
            status: existing.status,
          },
        }));
      } else {
        // A structural change (a Document or Folder appeared or vanished) is never taken
        // in unasked, and neither is anything while there are unsaved changes: reading
        // the Project again closes every Document without saving.
        const readable =
          !changes.project.structure &&
          changes.project.files.every((file) => file.readable);
        if (readable && !anythingUnsaved()) {
          await reloadProjectBy();
          return;
        }
        store.setState((state) => ({
          ...state,
          projectConflict: {
            structure: changes.project.structure,
            files: changes.project.files,
            status: "conflict",
          },
        }));
      }
    }

    for (const documentChanges of changes.documents) {
      const { documentId, files } = documentChanges;
      const open = applicationStore.getState().documents;
      if (!open.has(documentId)) continue;
      const existing = store
        .getState()
        .conflicts.find((entry) => entry.documentId === documentId);
      if (existing !== undefined) {
        setDocumentConflict({
          ...existing,
          files: mergeFiles(existing.files, files),
        });
        continue;
      }
      const unsaved =
        hasUnsavedDocumentChanges(applicationStore.getState(), [documentId]) ||
        options.hasPendingDraft([documentId]);
      if (!unsaved && files.every((file) => file.readable)) {
        await reloadDocumentBy(documentId);
        continue;
      }
      options.getDocumentSession(documentId)?.suspendSaving(CONFLICT_ERROR);
      setDocumentConflict({ documentId, files, status: "conflict" });
    }
  }

  async function checkNow(): Promise<void> {
    const project = currentProject();
    if (project === null) return;
    if (options.isBlocked()) {
      recheckPending = true;
      return;
    }
    recheckPending = false;
    const checked = await gateway.checkExternalChanges(project.projectId);
    if (!checked.ok) {
      options.onEvent({ type: "checkFailed", error: checked.error });
      return;
    }
    await process(checked.value);
  }

  function findConflict(documentId: DocumentId): DocumentConflict | undefined {
    return store
      .getState()
      .conflicts.find((entry) => entry.documentId === documentId);
  }

  // A text Block whose file was removed outside the app is written again from memory; the
  // save path itself never creates content.
  async function restoreRemovedContent(
    projectId: ProjectId,
    documentId: DocumentId,
    removedPaths: ReadonlySet<string>,
  ): Promise<OperationResult<void>> {
    const documentState = applicationStore.getState().documents.get(documentId);
    if (documentState === undefined) return operationOk(undefined);
    for (const sheet of documentState.sheets.values()) {
      for (const block of sheet.blocks) {
        if (
          !removedPaths.has(block.contentPath) ||
          !isTextBlockType(block.blockType)
        ) {
          continue;
        }
        const text = documentState.contents.get(block.blockId);
        // Never loaded: nothing in memory to write back.
        if (text === undefined) continue;
        const restored = await gateway.restoreBlockContent(
          projectId,
          documentId,
          block.blockType,
          block.contentPath,
          text,
        );
        if (!restored.ok) return restored;
      }
    }
    return operationOk(undefined);
  }

  async function overwriteDocument(
    projectId: ProjectId,
    documentId: DocumentId,
  ): Promise<OperationResult<void>> {
    const conflict = findConflict(documentId);
    if (conflict === undefined) return operationOk(undefined);
    const accepted = await gateway.acceptDiskState(projectId, documentId);
    if (!accepted.ok) return accepted;
    const removed = new Set(
      conflict.files
        .filter((file) => file.change === "removed")
        .map((file) => file.path),
    );
    const restored = await restoreRemovedContent(
      projectId,
      documentId,
      removed,
    );
    if (!restored.ok) return restored;
    const session = options.getDocumentSession(documentId);
    session?.resumeSaving();
    removeDocumentConflict(documentId);
    return session === null ? operationOk(undefined) : session.flush();
  }

  return {
    store,
    check: () => enqueue(checkNow),
    handleNotice: (notice) =>
      enqueue(async () => {
        const project = currentProject();
        if (project === null || notice.projectId !== project.projectId) return;
        await process(notice.changes);
      }),
    resume: () =>
      enqueue(async () => {
        if (recheckPending && !options.isBlocked()) await checkNow();
      }),
    keepCurrent(target) {
      if (target.kind === "project") {
        store.setState((state) =>
          state.projectConflict === null
            ? state
            : {
                ...state,
                projectConflict: { ...state.projectConflict, status: "kept" },
              },
        );
        return;
      }
      const conflict = findConflict(target.documentId);
      if (conflict !== undefined) {
        setDocumentConflict({ ...conflict, status: "kept" });
      }
    },
    reload: (target) =>
      enqueue(() =>
        target.kind === "project"
          ? reloadProjectBy()
          : reloadDocumentBy(target.documentId),
      ),
    overwrite: (target) =>
      enqueue(async () => {
        const project = currentProject();
        if (project === null) {
          return operationErr("projectNotOpen", "no project is open");
        }
        if (target.kind === "document") {
          return overwriteDocument(project.projectId, target.documentId);
        }
        const accepted = await gateway.acceptDiskState(project.projectId, null);
        if (!accepted.ok) return accepted;
        store.setState((state) => ({ ...state, projectConflict: null }));
        return options.saveAll();
      }),
  };
}
