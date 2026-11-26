// Takes a recorded tree change back ("undo") or makes it again ("redo"). Each change is
// checked against the tree as it is now: when its place is gone (the entry left the
// parent, the sibling it stood in front of was deleted, the folder was renamed again) the
// change is not applied and the answer is false, so nothing lands somewhere unexpected.

import type {
  DocumentId,
  EntryId,
  FolderId,
} from "../../domain/shared/entity-id";
import { type OperationResult, operationOk } from "../ports/operation-error";
import type { OpenProjectState } from "../state/application-state";
import {
  childOrderOf,
  deletionSteps,
  findFolder,
  findProjectEntry,
  type ParentId,
} from "./project-entries";
import type { ProjectTreeSteps } from "./project-tree-steps";
import type { TreeChange, TreeEntryKind, TreeStep } from "./tree-history";

export type ReplayDirection = "undo" | "redo";

export interface TreeReplayContext {
  readonly treeSteps: ProjectTreeSteps;
  requireProject(): OperationResult<OpenProjectState>;
  // Both run inside the workspace's lifecycle queue, like the tree steps.
  createDocument(
    name: string,
    parentFolderId: ParentId,
    documentId: DocumentId,
  ): Promise<OperationResult<DocumentId>>;
  deleteDocument(documentId: DocumentId): Promise<OperationResult<void>>;
}

const NOT_APPLIED = operationOk(false);
const APPLIED = operationOk(true);

export async function replayTreeStep(
  context: TreeReplayContext,
  step: TreeStep,
  direction: ReplayDirection,
): Promise<OperationResult<boolean>> {
  const changes = direction === "undo" ? [...step].reverse() : step;
  for (const change of changes) {
    const replayed = await replayChange(context, change, direction);
    if (!replayed.ok || !replayed.value) return replayed;
  }
  return APPLIED;
}

function replayChange(
  context: TreeReplayContext,
  change: TreeChange,
  direction: ReplayDirection,
): Promise<OperationResult<boolean>> {
  const project = context.requireProject();
  if (!project.ok) return Promise.resolve(project);
  const tree = project.value;
  const undo = direction === "undo";
  switch (change.kind) {
    case "reorder":
      return placeAmongSiblings(
        context,
        tree,
        change,
        undo ? change.from : change.to,
      );
    case "move":
      return undo
        ? moveBack(context, tree, change)
        : moveAgain(context, tree, change);
    case "create":
      return undo
        ? removeCreated(context, tree, change)
        : createAgain(context, tree, change);
    case "renameFolder":
      return renameAgain(
        context,
        tree,
        change.folderId,
        undo ? change.to : change.from,
        undo ? change.from : change.to,
      );
  }
}

// The entry is a `kind` entry in `parentId` now.
function isIn(
  tree: OpenProjectState,
  entryId: EntryId,
  kind: TreeEntryKind,
  parentId: ParentId,
): boolean {
  const found = findProjectEntry(tree, entryId);
  return (
    found !== null &&
    found.kind === kind &&
    found.entry.parentFolderId === parentId
  );
}

// A sibling to stand in front of: none (last), or one that is still in the parent.
function isSiblingIn(
  tree: OpenProjectState,
  parentId: ParentId,
  sibling: EntryId | null,
): boolean {
  return (
    sibling === null || childOrderOf(tree, parentId)?.includes(sibling) === true
  );
}

function isWritableParent(tree: OpenProjectState, parentId: ParentId): boolean {
  return parentId === null || findFolder(tree, parentId)?.state === "loaded";
}

async function placeAmongSiblings(
  context: TreeReplayContext,
  tree: OpenProjectState,
  change: Extract<TreeChange, { kind: "reorder" }>,
  before: EntryId | null,
): Promise<OperationResult<boolean>> {
  if (
    !isIn(tree, change.entryId, change.entryKind, change.parentId) ||
    !isSiblingIn(tree, change.parentId, before)
  ) {
    return NOT_APPLIED;
  }
  const moved = await context.treeSteps.reorder(
    change.entryKind,
    change.entryId,
    before,
  );
  return moved.ok ? APPLIED : moved;
}

async function moveBack(
  context: TreeReplayContext,
  tree: OpenProjectState,
  change: Extract<TreeChange, { kind: "move" }>,
): Promise<OperationResult<boolean>> {
  if (
    !isIn(tree, change.entryId, change.entryKind, change.toParent) ||
    !isWritableParent(tree, change.fromParent)
  ) {
    return NOT_APPLIED;
  }
  // Back in front of the sibling it stood before, when that one is still there (moving
  // the entry does not change the other children of the parent it goes back to).
  const before =
    change.fromBefore !== null &&
    isSiblingIn(tree, change.fromParent, change.fromBefore)
      ? change.fromBefore
      : null;
  const moved = await context.treeSteps.moveEntry(
    change.entryId,
    change.fromParent,
  );
  if (!moved.ok) return moved;
  if (before === null) return APPLIED;
  const placed = await context.treeSteps.reorder(
    change.entryKind,
    change.entryId,
    before,
  );
  return placed.ok ? APPLIED : placed;
}

async function moveAgain(
  context: TreeReplayContext,
  tree: OpenProjectState,
  change: Extract<TreeChange, { kind: "move" }>,
): Promise<OperationResult<boolean>> {
  if (
    !isIn(tree, change.entryId, change.entryKind, change.fromParent) ||
    !isWritableParent(tree, change.toParent)
  ) {
    return NOT_APPLIED;
  }
  const moved = await context.treeSteps.moveEntry(
    change.entryId,
    change.toParent,
  );
  return moved.ok ? APPLIED : moved;
}

// Deletes what was created, with whatever was put into it since (the user confirmed that
// before the step was taken): Documents first, then the folders from the deepest.
async function removeCreated(
  context: TreeReplayContext,
  tree: OpenProjectState,
  change: Extract<TreeChange, { kind: "create" }>,
): Promise<OperationResult<boolean>> {
  if (!isIn(tree, change.entryId, change.entryKind, change.parentId)) {
    return NOT_APPLIED;
  }
  for (const deletion of deletionSteps(tree, [change.entryId])) {
    const deleted =
      deletion.kind === "document"
        ? await context.deleteDocument(deletion.documentId)
        : await context.treeSteps.deleteFolder(deletion.folderId);
    if (!deleted.ok) return deleted;
  }
  return APPLIED;
}

async function createAgain(
  context: TreeReplayContext,
  tree: OpenProjectState,
  change: Extract<TreeChange, { kind: "create" }>,
): Promise<OperationResult<boolean>> {
  if (
    findProjectEntry(tree, change.entryId) !== null ||
    !isWritableParent(tree, change.parentId)
  ) {
    return NOT_APPLIED;
  }
  const created =
    change.entryKind === "document"
      ? await context.createDocument(
          change.name,
          change.parentId,
          change.entryId as DocumentId,
        )
      : await context.treeSteps.createFolder(
          change.parentId,
          change.name,
          change.entryId as FolderId,
        );
  return created.ok ? APPLIED : created;
}

async function renameAgain(
  context: TreeReplayContext,
  tree: OpenProjectState,
  folderId: FolderId,
  expected: string,
  name: string,
): Promise<OperationResult<boolean>> {
  const folder = findFolder(tree, folderId);
  if (folder?.state !== "loaded" || folder.name !== expected) {
    return NOT_APPLIED;
  }
  const renamed = await context.treeSteps.renameFolder(folderId, name);
  return renamed.ok ? APPLIED : renamed;
}
