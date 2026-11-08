// Pure geometry and decisions of moving a Project Tree row by dragging it: where the pointer
// is, and what that means for the entry being dragged (its new parent and place). Kept free
// of the DOM so the rules are testable without layout.

import type { EntryId, FolderId } from "../../../domain/shared/entity-id";
import { documentTreeKey, folderTreeKey, PROJECT_TREE_KEY } from "./tree-items";
import type { ProjectTreeModel, TreeEntryNode } from "./tree-model";

// Where on a row the pointer is, as a share of the row's height. A folder's top band puts
// the entry in front of it; the rest of the row puts it inside (a folded folder also has a
// bottom band that puts it after). A document has only "before" and "after" halves.
const FOLDER_EDGE_SHARE = 0.25;
const DOCUMENT_EDGE_SHARE = 0.5;

export type TreeDropPosition = "before" | "after" | "inside";

export interface TreeDropRow {
  readonly key: string;
  readonly top: number;
  readonly bottom: number;
}

// What the pointer is over. `key` null: the empty space below the rows, which means the
// Project's top level.
export interface TreeDropHit {
  readonly key: string | null;
  readonly position: TreeDropPosition;
}

// The new parent (null = the Project's top level) and the sibling to stand in front of
// (null = last).
export interface TreeMoveTarget {
  readonly parentFolderId: FolderId | null;
  readonly beforeEntryId: EntryId | null;
}

interface Located {
  readonly node: TreeEntryNode;
  // The folder holding the entry; null = the Project's top level.
  readonly parent: FolderId | null;
  readonly siblings: readonly TreeEntryNode[];
}

function keyOf(node: TreeEntryNode): string {
  return node.kind === "folder"
    ? folderTreeKey(node.folderId)
    : documentTreeKey(node.documentId);
}

function idOf(node: TreeEntryNode): EntryId {
  return node.kind === "folder" ? node.folderId : node.documentId;
}

function locate(
  entries: readonly TreeEntryNode[],
  key: string,
  parent: FolderId | null,
): Located | null {
  for (const node of entries) {
    if (keyOf(node) === key) return { node, parent, siblings: entries };
    if (node.kind === "folder") {
      const inside = locate(node.children, key, node.folderId);
      if (inside !== null) return inside;
    }
  }
  return null;
}

function contains(node: TreeEntryNode, key: string): boolean {
  if (keyOf(node) === key) return true;
  return (
    node.kind === "folder" &&
    node.children.some((child) => contains(child, key))
  );
}

// The row under the pointer and the band of it. Below the last row is the empty space (the
// top level); above the first row is nothing.
export function treeDropHitAt(
  rows: readonly TreeDropRow[],
  pointerY: number,
  rowKind: (
    key: string,
  ) => "project" | "folder" | "folderCollapsed" | "document",
): TreeDropHit | null {
  const last = rows[rows.length - 1];
  if (last !== undefined && pointerY >= last.bottom) {
    return { key: null, position: "inside" };
  }
  const row = rows.find(
    (candidate) => pointerY >= candidate.top && pointerY < candidate.bottom,
  );
  if (row === undefined) return null;
  const kind = rowKind(row.key);
  if (kind === "project") return { key: row.key, position: "inside" };
  const height = row.bottom - row.top;
  const share = height > 0 ? (pointerY - row.top) / height : 0;
  if (kind === "document") {
    return {
      key: row.key,
      position: share < DOCUMENT_EDGE_SHARE ? "before" : "after",
    };
  }
  if (share < FOLDER_EDGE_SHARE) return { key: row.key, position: "before" };
  if (kind === "folderCollapsed" && share >= 1 - FOLDER_EDGE_SHARE) {
    return { key: row.key, position: "after" };
  }
  return { key: row.key, position: "inside" };
}

// Inserts the dragged entry among `siblings` at the place the hit names and returns the
// sibling it then stands in front of; null when it would be the last.
function beforeOf(
  siblings: readonly TreeEntryNode[],
  draggedKey: string,
  hitKey: string,
  position: "before" | "after",
): EntryId | null {
  const others = siblings.filter((node) => keyOf(node) !== draggedKey);
  const index = others.findIndex((node) => keyOf(node) === hitKey);
  const insertAt = position === "before" ? index : index + 1;
  const next = others[insertAt];
  return next === undefined ? null : idOf(next);
}

// Whether the entry would end up exactly where it is: same parent, same place.
function staysInPlace(dragged: Located, target: TreeMoveTarget): boolean {
  if (dragged.parent !== target.parentFolderId) return false;
  const index = dragged.siblings.indexOf(dragged.node);
  const next = dragged.siblings[index + 1];
  return (next === undefined ? null : idOf(next)) === target.beforeEntryId;
}

// What dropping the dragged row on `hit` does, or null when it does nothing or is not
// allowed: a folder into itself or one of its own folders, anything into a folder that failed
// to load, an entry that failed to load, or a drop that leaves the entry where it is.
export function treeMoveTargetOf(
  model: ProjectTreeModel,
  draggedKey: string,
  hit: TreeDropHit | null,
): TreeMoveTarget | null {
  if (hit === null) return null;
  const dragged = locate(model.entries, draggedKey, null);
  if (dragged === null || dragged.node.state !== "loaded") return null;
  let target: TreeMoveTarget;
  if (hit.key === null || hit.key === PROJECT_TREE_KEY) {
    target = { parentFolderId: null, beforeEntryId: null };
  } else {
    if (contains(dragged.node, hit.key)) return null;
    const over = locate(model.entries, hit.key, null);
    if (over === null) return null;
    if (hit.position === "inside") {
      if (over.node.kind !== "folder" || over.node.state !== "loaded") {
        return null;
      }
      target = { parentFolderId: over.node.folderId, beforeEntryId: null };
    } else {
      target = {
        parentFolderId: over.parent,
        beforeEntryId: beforeOf(
          over.siblings,
          draggedKey,
          hit.key,
          hit.position,
        ),
      };
    }
  }
  return staysInPlace(dragged, target) ? null : target;
}
