// Flattens the tree model into the visible items in display order, with the keys the
// tree component uses for focus handling. Kept next to the model so both agree. Children
// of a collapsed folder are not visible, so they are not items.

import type {
  DocumentId,
  FolderId,
  SheetId,
} from "../../../domain/shared/entity-id";
import type { FlatTreeItem } from "./keyboard-navigation";
import type { ProjectTreeModel, TreeEntryNode } from "./tree-model";

export const PROJECT_TREE_KEY = "project";

export function documentTreeKey(documentId: DocumentId): string {
  return `document:${documentId}`;
}

export function folderTreeKey(folderId: FolderId): string {
  return `folder:${folderId}`;
}

export function sheetTreeKey(documentId: DocumentId, sheetId: SheetId): string {
  return `sheet:${documentId}:${sheetId}`;
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
      firstChildIndex: entry.sheets.length > 0 ? index + 1 : null,
      opensOnExpand: !entry.isOpen && entry.state === "loaded",
      folderState: null,
    });
    for (const sheetNode of entry.sheets) {
      items.push({
        key: sheetTreeKey(entry.documentId, sheetNode.sheetId),
        parentIndex: index,
        firstChildIndex: null,
        opensOnExpand: false,
        folderState: null,
      });
    }
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
