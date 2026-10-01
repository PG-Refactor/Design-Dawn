// Flattens the tree model into the visible items in display order, with the keys the
// tree component uses for focus handling. Kept next to the model so both agree.

import type { DocumentId, SheetId } from "../../../domain/shared/entity-id";
import type { FlatTreeItem } from "./keyboard-navigation";
import type { ProjectTreeModel } from "./tree-model";

export const PROJECT_TREE_KEY = "project";

export function documentTreeKey(documentId: DocumentId): string {
  return `document:${documentId}`;
}

export function sheetTreeKey(documentId: DocumentId, sheetId: SheetId): string {
  return `sheet:${documentId}:${sheetId}`;
}

export function flattenProjectTree(
  model: ProjectTreeModel,
): readonly FlatTreeItem[] {
  const items: FlatTreeItem[] = [
    {
      key: PROJECT_TREE_KEY,
      parentIndex: null,
      firstChildIndex: model.documents.length > 0 ? 1 : null,
      opensOnExpand: false,
    },
  ];
  for (const documentNode of model.documents) {
    const documentIndex = items.length;
    items.push({
      key: documentTreeKey(documentNode.documentId),
      parentIndex: 0,
      firstChildIndex:
        documentNode.sheets.length > 0 ? documentIndex + 1 : null,
      opensOnExpand: !documentNode.isOpen && documentNode.state === "loaded",
    });
    for (const sheetNode of documentNode.sheets) {
      items.push({
        key: sheetTreeKey(documentNode.documentId, sheetNode.sheetId),
        parentIndex: documentIndex,
        firstChildIndex: null,
        opensOnExpand: false,
      });
    }
  }
  return items;
}
