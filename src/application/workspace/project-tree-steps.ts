// Project-level operations on Folders and on where entries sit in the tree: create /
// rename / reorder / move / delete a Folder, and saving the files that hold an order
// (`project.json`, `folder.json`). Every step is NOT undoable and runs on the workspace's
// lifecycle queue (the caller wraps it); the order of gateway calls is the one in
// docs/architecture.md §6.2.4.
//
// Failure rule (same as the rest of the workspace): memory never claims something that is
// not true on disk. When a step fails AFTER something changed on disk, the affected parent
// stays in memory with its save state dirty and `lastError`, so a retry persists it.

import { parseDisplayName } from "../../domain/shared/display-name";
import type { EntryId, FolderId } from "../../domain/shared/entity-id";
import { moveInOrder } from "../../domain/shared/ordered-ids";
import type { IdGenerator } from "../id-generator";
import {
  failWith,
  fromDomainResult,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type { PersistenceGateway } from "../ports/persistence-gateway";
import type { OpenProjectState } from "../state/application-state";
import {
  CLEAN_SAVE,
  childOrderOf,
  findFolder,
  findProjectEntry,
  folderValueOf,
  hasChildren,
  isFolderAtOrBelow,
  orderWithout,
  type ParentId,
  requireWritableParent,
  sortSiblings,
  withAppendedChild,
  withChildOrder,
  withFolderName,
  withParentSave,
} from "./project-entries";

export interface ProjectTreeContext {
  readonly gateway: PersistenceGateway;
  readonly idGenerator: IdGenerator;
  requireProject(): OperationResult<OpenProjectState>;
  updateProject(update: (project: OpenProjectState) => OpenProjectState): void;
  // Saves `project.json` from memory and settles the project's save state.
  saveCurrentProject(): Promise<OperationResult<void>>;
}

export interface ProjectTreeSteps {
  // Saves the file of a parent from memory (the Project or a Folder).
  saveParent(parentId: ParentId): Promise<OperationResult<void>>;
  // Writes `order` as the parent's order WITHOUT touching memory: for deletions, where
  // the order must be on disk before the directory goes.
  saveOrderOf(
    parentId: ParentId,
    order: readonly EntryId[],
  ): Promise<OperationResult<void>>;
  saveFolder(folderId: FolderId): Promise<OperationResult<void>>;
  // Saves every folder with unsaved changes; stops at the first failure when `stopOnError`.
  saveDirtyFolders(stopOnError: boolean): Promise<OperationResult<void>>;
  createFolder(
    parentFolderId: ParentId,
    name: string,
  ): Promise<OperationResult<FolderId>>;
  renameFolder(
    folderId: FolderId,
    name: string,
  ): Promise<OperationResult<void>>;
  reorder(
    kind: "folder" | "document",
    entryId: EntryId,
    beforeEntryId: EntryId | null,
  ): Promise<OperationResult<void>>;
  moveEntry(
    entryId: EntryId,
    targetParentFolderId: ParentId,
  ): Promise<OperationResult<void>>;
  deleteFolder(folderId: FolderId): Promise<OperationResult<void>>;
}

export function createProjectTreeSteps(
  context: ProjectTreeContext,
): ProjectTreeSteps {
  const { gateway, idGenerator, requireProject, updateProject } = context;

  async function saveOrderOf(
    parentId: ParentId,
    order: readonly EntryId[],
  ): Promise<OperationResult<void>> {
    const project = requireProject();
    if (!project.ok) return project;
    if (parentId === null) {
      return gateway.saveProject(project.value.projectId, {
        ...project.value.project,
        childOrder: order,
      });
    }
    const entry = findFolder(project.value, parentId);
    if (entry === undefined) {
      return operationErr("entityNotFound", `folder not found: ${parentId}`);
    }
    const folder = folderValueOf(entry, order);
    if (!folder.ok) return failWith(folder.error);
    return gateway.saveFolder(project.value.projectId, folder.value);
  }

  async function saveFolder(
    folderId: FolderId,
  ): Promise<OperationResult<void>> {
    const project = requireProject();
    if (!project.ok) return project;
    const entry = findFolder(project.value, folderId);
    if (entry === undefined) {
      return operationErr("entityNotFound", `folder not found: ${folderId}`);
    }
    const saved = await saveOrderOf(folderId, entry.childOrder);
    updateProject((current) =>
      findFolder(current, folderId) === undefined
        ? current
        : withParentSave(
            current,
            folderId,
            saved.ok ? CLEAN_SAVE : { dirty: true, lastError: saved.error },
          ),
    );
    return saved;
  }

  function saveParent(parentId: ParentId): Promise<OperationResult<void>> {
    return parentId === null
      ? context.saveCurrentProject()
      : saveFolder(parentId);
  }

  async function saveDirtyFolders(
    stopOnError: boolean,
  ): Promise<OperationResult<void>> {
    const project = requireProject();
    // No project: nothing is unsaved (closing everything may run before one is open).
    if (!project.ok) return operationOk(undefined);
    let firstFailure: OperationResult<void> | null = null;
    for (const entry of project.value.folders) {
      if (!entry.save.dirty) continue;
      const saved = await saveFolder(entry.folderId);
      if (!saved.ok) {
        if (stopOnError) return saved;
        firstFailure ??= saved;
      }
    }
    return firstFailure ?? operationOk(undefined);
  }

  async function createFolder(
    parentFolderId: ParentId,
    name: string,
  ): Promise<OperationResult<FolderId>> {
    const project = requireProject();
    if (!project.ok) return project;
    const parent = requireWritableParent(project.value, parentFolderId);
    if (!parent.ok) return parent;
    const displayName = fromDomainResult(parseDisplayName(name));
    if (!displayName.ok) return failWith(displayName.error);
    const folderId = idGenerator.folderId();
    const created = await gateway.createFolder(
      project.value.projectId,
      parentFolderId,
      folderId,
      displayName.value,
    );
    if (!created.ok) return created;
    const snapshot = created.value;
    if (
      snapshot.folderId !== folderId ||
      snapshot.state !== "loaded" ||
      snapshot.name === null
    ) {
      return operationErr(
        "invalidCommandResponse",
        `the created folder is not the requested folder ${folderId}`,
      );
    }
    const folderName = snapshot.name;
    const current = requireProject();
    if (!current.ok) return current;
    const listed = withAppendedChild(
      {
        ...current.value,
        folders: [
          ...current.value.folders,
          {
            folderId,
            name: folderName,
            parentFolderId,
            childOrder: snapshot.childOrder,
            state: "loaded",
            save: CLEAN_SAVE,
          },
        ],
      },
      parentFolderId,
      folderId,
    );
    if (!listed.ok) return failWith(listed.error);
    // The directory exists now, so it is listed even if saving the parent's order fails.
    updateProject(() => listed.value);
    const saved = await saveParent(parentFolderId);
    return saved.ok ? operationOk(folderId) : saved;
  }

  async function renameFolder(
    folderId: FolderId,
    name: string,
  ): Promise<OperationResult<void>> {
    const project = requireProject();
    if (!project.ok) return project;
    const entry = findFolder(project.value, folderId);
    if (entry === undefined) {
      return operationErr("entityNotFound", `folder not found: ${folderId}`);
    }
    if (entry.state !== "loaded") {
      return operationErr("notWritable", `folder is not loaded: ${folderId}`);
    }
    const displayName = fromDomainResult(parseDisplayName(name));
    if (!displayName.ok) return failWith(displayName.error);
    updateProject((current) =>
      withFolderName(current, folderId, displayName.value),
    );
    return saveFolder(folderId);
  }

  async function reorder(
    kind: "folder" | "document",
    entryId: EntryId,
    beforeEntryId: EntryId | null,
  ): Promise<OperationResult<void>> {
    const project = requireProject();
    if (!project.ok) return project;
    const found = findProjectEntry(project.value, entryId);
    if (found === null || found.kind !== kind) {
      return operationErr("entityNotFound", `${kind} not found: ${entryId}`);
    }
    if (found.kind === "folder" && found.entry.state !== "loaded") {
      return operationErr("notWritable", `folder is not loaded: ${entryId}`);
    }
    const parentId = found.entry.parentFolderId;
    const order = childOrderOf(project.value, parentId);
    if (order === null) {
      return operationErr("entityNotFound", `folder not found: ${parentId}`);
    }
    const moved = fromDomainResult(moveInOrder(order, entryId, beforeEntryId));
    if (!moved.ok) return failWith(moved.error);
    updateProject((current) => {
      const next = withChildOrder(current, parentId, moved.value);
      return {
        ...next,
        documents: sortSiblings(
          next.documents,
          parentId,
          moved.value,
          (entry) => entry.documentId,
        ),
        folders: sortSiblings(
          next.folders,
          parentId,
          moved.value,
          (entry) => entry.folderId,
        ),
      };
    });
    return saveParent(parentId);
  }

  // The rules Rust validates again; checked here first so an impossible move never starts.
  function checkMove(
    project: OpenProjectState,
    entryId: EntryId,
    targetParentFolderId: ParentId,
  ): OperationResult<void> {
    const found = findProjectEntry(project, entryId);
    if (found === null) {
      return operationErr("entityNotFound", `entry not found: ${entryId}`);
    }
    if (found.kind === "folder" && found.entry.state !== "loaded") {
      return operationErr("notWritable", `folder is not loaded: ${entryId}`);
    }
    const target = requireWritableParent(project, targetParentFolderId);
    if (!target.ok) return target;
    if (
      found.kind === "folder" &&
      isFolderAtOrBelow(project, targetParentFolderId, found.entry.folderId)
    ) {
      return operationErr(
        "invalidMove",
        "a folder cannot move into itself or a descendant",
      );
    }
    return operationOk(undefined);
  }

  async function moveEntry(
    entryId: EntryId,
    targetParentFolderId: ParentId,
  ): Promise<OperationResult<void>> {
    const project = requireProject();
    if (!project.ok) return project;
    const checked = checkMove(project.value, entryId, targetParentFolderId);
    if (!checked.ok) return checked;
    const found = findProjectEntry(project.value, entryId);
    if (found === null) return operationOk(undefined);
    const sourceParentId = found.entry.parentFolderId;
    // Moving to where it already is changes nothing (Rust accepts it as a no-op too).
    if (sourceParentId === targetParentFolderId) return operationOk(undefined);
    const moved = await gateway.moveEntry(
      project.value.projectId,
      entryId,
      targetParentFolderId,
    );
    if (!moved.ok) return moved;
    // The entry is at its new place on disk; both orders are updated in memory first and
    // each save then decides whether its parent stays dirty.
    const current = requireProject();
    if (!current.ok) return current;
    const withoutSource = orderWithout(current.value, sourceParentId, entryId);
    if (!withoutSource.ok) return failWith(withoutSource.error);
    let next = current.value;
    if (withoutSource.value !== null) {
      next = withChildOrder(next, sourceParentId, withoutSource.value);
    }
    next =
      found.kind === "folder"
        ? {
            ...next,
            folders: next.folders.map((entry) =>
              entry.folderId === entryId
                ? { ...entry, parentFolderId: targetParentFolderId }
                : entry,
            ),
          }
        : {
            ...next,
            documents: next.documents.map((entry) =>
              entry.documentId === entryId
                ? { ...entry, parentFolderId: targetParentFolderId }
                : entry,
            ),
          };
    const appended = withAppendedChild(next, targetParentFolderId, entryId);
    if (!appended.ok) return failWith(appended.error);
    updateProject(() => appended.value);
    // Target first: if the process stops in between, the old parent still lists an entry
    // that is no longer its child (dropped on load) instead of nobody listing it.
    const targetSaved = await saveParent(targetParentFolderId);
    const sourceSaved =
      withoutSource.value === null
        ? operationOk(undefined)
        : await saveParent(sourceParentId);
    return targetSaved.ok ? sourceSaved : targetSaved;
  }

  async function deleteFolder(
    folderId: FolderId,
  ): Promise<OperationResult<void>> {
    const project = requireProject();
    if (!project.ok) return project;
    const entry = findFolder(project.value, folderId);
    if (entry === undefined) {
      return operationErr("entityNotFound", `folder not found: ${folderId}`);
    }
    if (hasChildren(project.value, folderId)) {
      return operationErr("folderNotEmpty", `folder is not empty: ${folderId}`);
    }
    const parentId = entry.parentFolderId;
    const without = orderWithout(project.value, parentId, folderId);
    if (!without.ok) return failWith(without.error);
    // Order first: if the process dies before the directory is deleted, an unlisted
    // directory remains (reported on load) instead of a listed one that is gone.
    if (without.value !== null) {
      const saved = await saveOrderOf(parentId, without.value);
      if (!saved.ok) return saved;
    }
    const deleted = await gateway.deleteFolder(
      project.value.projectId,
      folderId,
    );
    if (!deleted.ok) {
      // The directory is still there but the saved order lost it: keep it listed in
      // memory and dirty, so the order is saved again.
      if (without.value !== null) {
        updateProject((current) =>
          withParentSave(current, parentId, {
            dirty: true,
            lastError: deleted.error,
          }),
        );
      }
      return deleted;
    }
    updateProject((current) => {
      const withoutFolder = {
        ...current,
        folders: current.folders.filter(
          (folder) => folder.folderId !== folderId,
        ),
      };
      if (without.value === null) return withoutFolder;
      return withParentSave(
        withChildOrder(withoutFolder, parentId, without.value),
        parentId,
        CLEAN_SAVE,
      );
    });
    return operationOk(undefined);
  }

  return {
    saveParent,
    saveOrderOf,
    saveFolder,
    saveDirtyFolders,
    createFolder,
    renameFolder,
    reorder,
    moveEntry,
    deleteFolder,
  };
}
