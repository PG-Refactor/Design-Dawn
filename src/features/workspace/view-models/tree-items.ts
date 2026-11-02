// Flattens the tree model into the visible items in display order, with the keys the
// tree component uses for focus handling. Kept next to the model so both agree. Children
// of a collapsed folder are not visible, so they are not items.

import type { DocumentId, FolderId } from "../../../domain/shared/entity-id";
import type { FlatTreeItem } from "./keyboard-navigation";
import type { FolderNode, ProjectTreeModel, TreeEntryNode } from "./tree-model";

export const PROJECT_TREE_KEY = "project";

export function documentTreeKey(documentId: DocumentId): string {
  return `document:${documentId}`;
}

export function folderTreeKey(folderId: FolderId): string {
  return `folder:${folderId}`;
}

function pushEntries(
  items: FlatTreeItem[],
  entries: readonly TreeEntryNode[],
  parentIndex: number,
): void {
  for (const entry of entries) {
    const index = items.length;
    if (entry.kind === "folder") {
      const visibleChildren = entry.isExpanded ? entry.children : [];
      items.push({
        key: folderTreeKey(entry.folderId),
        parentIndex,
        firstChildIndex: visibleChildren.length > 0 ? index + 1 : null,
        opensOnExpand: false,
        folderState: entry.isExpanded ? "expanded" : "collapsed",
      });
      pushEntries(items, visibleChildren, index);
      continue;
    }
    items.push({
      key: documentTreeKey(entry.documentId),
      parentIndex,
      firstChildIndex: null,
      opensOnExpand: !entry.isOpen && entry.state === "loaded",
      folderState: null,
    });
  }
}

export function flattenProjectTree(
  model: ProjectTreeModel,
): readonly FlatTreeItem[] {
  const items: FlatTreeItem[] = [
    {
      key: PROJECT_TREE_KEY,
      parentIndex: null,
      firstChildIndex: model.entries.length > 0 ? 1 : null,
      opensOnExpand: false,
      folderState: null,
    },
  ];
  pushEntries(items, model.entries, 0);
  return items;
}

// Where the tree's "New Folder" / "New Document" buttons create an entry, from the row the
// tree cursor is on: inside a folder, next to a document (in its folder), or at the
// Project's top level. A folder that failed to load cannot take children, so the buttons
// are unavailable there.
export interface CreationTarget {
  readonly parentFolderId: FolderId | null;
  // The folder's name; null for the Project's top level (or a folder whose name failed).
  readonly folderName: string | null;
  readonly available: boolean;
}

const PROJECT_LEVEL_TARGET: CreationTarget = {
  parentFolderId: null,
  folderName: null,
  available: true,
};

function folderTarget(folder: FolderNode): CreationTarget {
  return {
    parentFolderId: folder.folderId,
    folderName: folder.name,
    available: folder.state !== "loadFailed",
  };
}

function findCreationTarget(
  entries: readonly TreeEntryNode[],
  key: string,
  container: CreationTarget,
): CreationTarget | null {
  for (const entry of entries) {
    if (entry.kind === "document") {
      if (documentTreeKey(entry.documentId) === key) return container;
      continue;
    }
    const inside = folderTarget(entry);
    if (folderTreeKey(entry.folderId) === key) return inside;
    const nested = findCreationTarget(entry.children, key, inside);
    if (nested !== null) return nested;
  }
  return null;
}

export function creationTargetOf(
  model: ProjectTreeModel,
  key: string,
): CreationTarget {
  if (key === PROJECT_TREE_KEY) return PROJECT_LEVEL_TARGET;
  return (
    findCreationTarget(model.entries, key, PROJECT_LEVEL_TARGET) ??
    PROJECT_LEVEL_TARGET
  );
}
