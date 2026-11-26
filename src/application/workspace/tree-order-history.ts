// Undo / redo of moving Documents and Folders among their siblings in the Project tree. It
// is the Project's own history, apart from each Document's: the order lives in
// `project.json` / `folder.json`, not in a Document. A step records where the entry was
// and where it went, and is checked again when it is taken (the tree may have changed in
// between), so nothing else in the tree needs to clear it.

import type { EntryId } from "../../domain/shared/entity-id";
import type { ParentId } from "./project-entries";

export interface TreeReorder {
  readonly kind: "folder" | "document";
  readonly entryId: EntryId;
  readonly parentId: ParentId;
  // The sibling the entry stood in front of before the move, and after it (null: last).
  readonly from: EntryId | null;
  readonly to: EntryId | null;
}

export interface TreeOrderHistory {
  // A new move: what was undone before cannot be redone any more.
  record(step: TreeReorder): void;
  // The step to undo / redo, moved to the other side; null when there is none.
  takeUndo(): TreeReorder | null;
  takeRedo(): TreeReorder | null;
  clear(): void;
}

export function createTreeOrderHistory(limit: number): TreeOrderHistory {
  let undoSteps: readonly TreeReorder[] = [];
  let redoSteps: readonly TreeReorder[] = [];

  function pushed(
    steps: readonly TreeReorder[],
    step: TreeReorder,
  ): readonly TreeReorder[] {
    return [...steps, step].slice(-limit);
  }

  return {
    record(step) {
      undoSteps = pushed(undoSteps, step);
      redoSteps = [];
    },
    takeUndo() {
      const step = undoSteps.at(-1) ?? null;
      if (step === null) return null;
      undoSteps = undoSteps.slice(0, -1);
      redoSteps = pushed(redoSteps, step);
      return step;
    },
    takeRedo() {
      const step = redoSteps.at(-1) ?? null;
      if (step === null) return null;
      redoSteps = redoSteps.slice(0, -1);
      undoSteps = pushed(undoSteps, step);
      return step;
    },
    clear() {
      undoSteps = [];
      redoSteps = [];
    },
  };
}
