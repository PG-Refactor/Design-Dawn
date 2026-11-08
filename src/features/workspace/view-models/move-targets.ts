// The rows of the "move to..." dialog tree: the Project root and every Folder, depth first in
// display order. Pure. A target that cannot be chosen stays listed, disabled with the
// reason, so the user sees why instead of wondering where a folder went.

import type { ApplicationState } from "../../../application/state/application-state";
import {
  childOrderOf,
  findProjectEntry,
  isFolderAtOrBelow,
  type ParentId,
} from "../../../application/workspace/project-entries";
import type { EntryId, FolderId } from "../../../domain/shared/entity-id";

export type MoveTargetDisabledReason =
  // Moving to where the entries already are would change nothing.
  | "currentParent"
  // A moved folder itself or something inside it.
  | "selfOrDescendant"
  // A folder that failed to load cannot take new entries.
  | "notLoaded";

// Identifies a row; the Project root has its own key.
export const MOVE_TARGET_ROOT_KEY = "project-root";

export function moveTargetKey(parentFolderId: ParentId): string {
  return parentFolderId ?? MOVE_TARGET_ROOT_KEY;
}

export interface MoveTarget {
  // null = the Project root.
  readonly parentFolderId: ParentId;
  readonly key: string;
  // The row this one is nested under; null for the Project root.
  readonly parentKey: string | null;
  // Whether a Folder is nested under this row (the dialog can fold it).
  readonly hasChildFolders: boolean;
  // null for the Project root and for a Folder whose name could not be loaded; the text
  // for both is chosen at render time, so it follows the display language.
  readonly name: string | null;
  readonly depth: number;
  readonly disabledReason: MoveTargetDisabledReason | null;
}

// `entryIds`: what moves (one entry, or several chosen in the tree). The current parent is
// disabled only when every entry is already directly in it.
export function selectMoveTargets(
  application: Pick<ApplicationState, "project">,
  entryIds: readonly EntryId[],
): readonly MoveTarget[] {
  const project = application.project;
  if (project === null) return [];
  const moved = entryIds.flatMap((entryId) => {
    const found = findProjectEntry(project, entryId);
    return found === null ? [] : [found];
  });
  const [first] = moved;
  if (first === undefined) return [];
  const parents = new Set(moved.map((found) => found.entry.parentFolderId));
  const currentParent =
    parents.size === 1 ? first.entry.parentFolderId : undefined;
  const movedFolderIds = moved.flatMap((found) =>
    found.kind === "folder" ? [found.entry.folderId] : [],
  );
  const targets: MoveTarget[] = [
    {
      parentFolderId: null,
      key: MOVE_TARGET_ROOT_KEY,
      parentKey: null,
      hasChildFolders: project.folders.some(
        (entry) => entry.parentFolderId === null,
      ),
      name: null,
      depth: 0,
      disabledReason: currentParent === null ? "currentParent" : null,
    },
  ];
  function addFolders(parentId: ParentId, depth: number): void {
    if (project === null) return;
    const order = childOrderOf(project, parentId) ?? [];
    const position = (folderId: FolderId): number => {
      const index = order.indexOf(folderId);
      return index < 0 ? order.length : index;
    };
    const folders = project.folders
      .filter((entry) => entry.parentFolderId === parentId)
      .sort(
        (first, second) => position(first.folderId) - position(second.folderId),
      );
    for (const folder of folders) {
      const selfOrDescendant = movedFolderIds.some((movedFolderId) =>
        isFolderAtOrBelow(project, folder.folderId, movedFolderId),
      );
      targets.push({
        parentFolderId: folder.folderId,
        key: moveTargetKey(folder.folderId),
        parentKey: moveTargetKey(parentId),
        hasChildFolders:
          project?.folders.some(
            (entry) => entry.parentFolderId === folder.folderId,
          ) ?? false,
        name: folder.name,
        depth,
        disabledReason: selfOrDescendant
          ? "selfOrDescendant"
          : folder.state !== "loaded"
            ? "notLoaded"
            : currentParent === folder.folderId
              ? "currentParent"
              : null,
      });
      addFolders(folder.folderId, depth + 1);
    }
  }
  addFolders(null, 1);
  return targets;
}

// The rows that are shown: a row is hidden while any ancestor is folded. Relies on the
// depth-first order of `selectMoveTargets`, where a parent always precedes its children.
export function visibleMoveTargets(
  targets: readonly MoveTarget[],
  expandedKeys: ReadonlySet<string>,
): readonly MoveTarget[] {
  const shownAndOpen = new Set<string>();
  const visible: MoveTarget[] = [];
  for (const target of targets) {
    if (target.parentKey !== null && !shownAndOpen.has(target.parentKey)) {
      continue;
    }
    visible.push(target);
    if (expandedKeys.has(target.key)) shownAndOpen.add(target.key);
  }
  return visible;
}

// A new folder can be created inside the current parent (it is only "disabled" as a move
// target), but not inside the moved folder (it would be its own descendant) nor inside a
// folder that failed to load.
export function canCreateFolderIn(target: MoveTarget): boolean {
  return (
    target.disabledReason !== "selfOrDescendant" &&
    target.disabledReason !== "notLoaded"
  );
}
