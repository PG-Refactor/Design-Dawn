// The choices of the "move to..." dialog: the Project root and every Folder, depth first in
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
import { MESSAGES } from "../workspace-messages";

export type MoveTargetDisabledReason =
  // Moving to where the entry already is would change nothing.
  | "currentParent"
  // The entry itself or something inside it.
  | "selfOrDescendant"
  // A folder that failed to load cannot take new entries.
  | "notLoaded";

export interface MoveTarget {
  // null = the Project root.
  readonly parentFolderId: ParentId;
  readonly name: string;
  readonly depth: number;
  readonly disabledReason: MoveTargetDisabledReason | null;
}

export function selectMoveTargets(
  application: Pick<ApplicationState, "project">,
  entryId: EntryId,
): readonly MoveTarget[] {
  const project = application.project;
  if (project === null) return [];
  const moved = findProjectEntry(project, entryId);
  if (moved === null) return [];
  const currentParent = moved.entry.parentFolderId;
  const targets: MoveTarget[] = [
    {
      parentFolderId: null,
      name: MESSAGES.dialogs.moveEntry.projectRoot,
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
      const selfOrDescendant =
        moved?.kind === "folder" &&
        isFolderAtOrBelow(project, folder.folderId, moved.entry.folderId);
      targets.push({
        parentFolderId: folder.folderId,
        name: folder.name ?? MESSAGES.tree.unnamedEntity,
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
