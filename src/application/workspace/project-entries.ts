// Pure queries and updates on the Project's folder tree as the application state holds it.
// "Parent" is a Folder id, or null for the Project itself;
// both own a `childOrder` and a save state, so one set of functions serves both.

import { CURRENT_SCHEMA_VERSIONS } from "../../domain/domain-constants";
import { type Folder, parseFolder } from "../../domain/folder/folder";
import type {
  DocumentId,
  EntryId,
  FolderId,
} from "../../domain/shared/entity-id";
import { addToOrder, removeFromOrder } from "../../domain/shared/ordered-ids";
import {
  failWith,
  fromDomainResult,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type {
  OpenProjectDocumentEntry,
  OpenProjectFolderEntry,
  OpenProjectState,
  ProjectSaveState,
} from "../state/application-state";

export type ParentId = FolderId | null;

export const CLEAN_SAVE: ProjectSaveState = { dirty: false, lastError: null };

export type ProjectEntry =
  | { readonly kind: "folder"; readonly entry: OpenProjectFolderEntry }
  | { readonly kind: "document"; readonly entry: OpenProjectDocumentEntry };

export function findFolder(
  project: OpenProjectState,
  folderId: FolderId,
): OpenProjectFolderEntry | undefined {
  return project.folders.find((entry) => entry.folderId === folderId);
}

export function findProjectEntry(
  project: OpenProjectState,
  entryId: EntryId,
): ProjectEntry | null {
  const folder = findFolder(project, entryId as FolderId);
  if (folder !== undefined) return { kind: "folder", entry: folder };
  const document = project.documents.find(
    (entry) => entry.documentId === entryId,
  );
  return document === undefined ? null : { kind: "document", entry: document };
}

export function childOrderOf(
  project: OpenProjectState,
  parentId: ParentId,
): readonly EntryId[] | null {
  if (parentId === null) return project.project.childOrder;
  return findFolder(project, parentId)?.childOrder ?? null;
}

// The new order is in memory only until the caller saves it, so the parent is marked
// dirty (keeping an earlier error until a save succeeds).
export function withChildOrder(
  project: OpenProjectState,
  parentId: ParentId,
  order: readonly EntryId[],
): OpenProjectState {
  if (parentId === null) {
    return {
      ...project,
      project: { ...project.project, childOrder: order },
      save: { dirty: true, lastError: project.save.lastError },
    };
  }
  return {
    ...project,
    folders: project.folders.map((entry) =>
      entry.folderId === parentId
        ? {
            ...entry,
            childOrder: order,
            save: { dirty: true, lastError: entry.save.lastError },
          }
        : entry,
    ),
  };
}

export function withAppendedChild(
  project: OpenProjectState,
  parentId: ParentId,
  entryId: EntryId,
): OperationResult<OpenProjectState> {
  const order = childOrderOf(project, parentId);
  if (order === null) {
    return operationErr("entityNotFound", `folder not found: ${parentId}`);
  }
  const added = fromDomainResult(addToOrder(order, entryId));
  return added.ok
    ? operationOk(withChildOrder(project, parentId, added.value))
    : failWith(added.error);
}

// The order without `entryId`, or null when the parent does not list it (an unlisted
// entry has nothing to remove).
export function orderWithout(
  project: OpenProjectState,
  parentId: ParentId,
  entryId: EntryId,
): OperationResult<readonly EntryId[] | null> {
  const order = childOrderOf(project, parentId);
  if (order === null) {
    return operationErr("entityNotFound", `folder not found: ${parentId}`);
  }
  if (!order.includes(entryId)) return operationOk(null);
  const removed = fromDomainResult(removeFromOrder(order, entryId));
  return removed.ok ? operationOk(removed.value) : failWith(removed.error);
}

export function withParentSave(
  project: OpenProjectState,
  parentId: ParentId,
  save: ProjectSaveState,
): OpenProjectState {
  if (parentId === null) return { ...project, save };
  return {
    ...project,
    folders: project.folders.map((entry) =>
      entry.folderId === parentId ? { ...entry, save } : entry,
    ),
  };
}

export function withFolderName(
  project: OpenProjectState,
  folderId: FolderId,
  name: string,
): OpenProjectState {
  return {
    ...project,
    folders: project.folders.map((entry) =>
      entry.folderId === folderId
        ? {
            ...entry,
            name,
            save: { dirty: true, lastError: entry.save.lastError },
          }
        : entry,
    ),
  };
}

// The folder as it is written to `folder.json`, with `childOrder` as given (so a caller
// can save an order that memory does not hold yet). A folder whose name could not be
// loaded has no valid value and is never written.
export function folderValueOf(
  entry: OpenProjectFolderEntry,
  childOrder: readonly EntryId[],
): OperationResult<Folder> {
  if (entry.state !== "loaded" || entry.name === null) {
    return operationErr(
      "notWritable",
      `folder is not writable: ${entry.folderId}`,
    );
  }
  return fromDomainResult(
    parseFolder({
      schemaVersion: CURRENT_SCHEMA_VERSIONS.folder,
      folderId: entry.folderId,
      name: entry.name,
      childOrder,
    }),
  );
}

// A parent that new children can be added to: the Project, or a loaded Folder.
export function requireWritableParent(
  project: OpenProjectState,
  parentId: ParentId,
): OperationResult<void> {
  if (parentId === null) return operationOk(undefined);
  const folder = findFolder(project, parentId);
  if (folder === undefined) {
    return operationErr("entityNotFound", `folder not found: ${parentId}`);
  }
  return folder.state === "loaded"
    ? operationOk(undefined)
    : operationErr("notWritable", `folder is not loaded: ${parentId}`);
}

// Whether `candidate` is `ancestor` itself or lies below it. `null` (the Project) is
// below nothing.
export function isFolderAtOrBelow(
  project: OpenProjectState,
  candidate: ParentId,
  ancestor: FolderId,
): boolean {
  const visited = new Set<FolderId>();
  let current = candidate;
  while (current !== null && !visited.has(current)) {
    if (current === ancestor) return true;
    visited.add(current);
    current = findFolder(project, current)?.parentFolderId ?? null;
  }
  return false;
}

export function documentsUnder(
  project: OpenProjectState,
  folderId: FolderId,
): readonly DocumentId[] {
  return project.documents
    .filter((entry) =>
      isFolderAtOrBelow(project, entry.parentFolderId, folderId),
    )
    .map((entry) => entry.documentId);
}

export function hasChildren(
  project: OpenProjectState,
  folderId: FolderId,
): boolean {
  return (
    project.folders.some((entry) => entry.parentFolderId === folderId) ||
    project.documents.some((entry) => entry.parentFolderId === folderId)
  );
}

// Re-sorts only the entries that belong to `parentId`, in the slots they already occupy,
// so the flat lists stay stable for everything else. Entries the order does not list stay
// behind the listed ones.
export function sortSiblings<
  Entry extends { readonly parentFolderId: ParentId },
>(
  entries: readonly Entry[],
  parentId: ParentId,
  order: readonly EntryId[],
  idOf: (entry: Entry) => EntryId,
): readonly Entry[] {
  const position = (entry: Entry): number => {
    const index = order.indexOf(idOf(entry));
    return index < 0 ? order.length : index;
  };
  const sorted = entries
    .filter((entry) => entry.parentFolderId === parentId)
    .sort((first, second) => position(first) - position(second));
  let next = 0;
  return entries.map((entry) =>
    entry.parentFolderId === parentId ? (sorted[next++] ?? entry) : entry,
  );
}
