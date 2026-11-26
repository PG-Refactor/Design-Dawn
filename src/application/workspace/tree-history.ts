// Undo / redo of what the Project tree changes: entries moved among their siblings or into
// another parent, Documents and Folders created, Folders renamed. It is the Project's own
// history, apart from each Document's (the tree lives in `project.json` / `folder.json`).
// One step is one thing the user did (a drag of several rows, "a/b/c" making three
// folders); each of its changes is checked again when it is taken, since the tree may have
// changed in between.

import type { EntryId, FolderId } from "../../domain/shared/entity-id";
import type { ParentId } from "./project-entries";

export type TreeEntryKind = "folder" | "document";

export type TreeChange =
  // Moved among its siblings: in front of `from` before, in front of `to` after (null: last).
  | {
      readonly kind: "reorder";
      readonly entryKind: TreeEntryKind;
      readonly entryId: EntryId;
      readonly parentId: ParentId;
      readonly from: EntryId | null;
      readonly to: EntryId | null;
    }
  // Moved into another parent, where it is appended; `fromBefore` is where it stood.
  | {
      readonly kind: "move";
      readonly entryKind: TreeEntryKind;
      readonly entryId: EntryId;
      readonly fromParent: ParentId;
      readonly fromBefore: EntryId | null;
      readonly toParent: ParentId;
    }
  // Created last in its parent. `sheetCount`: the sheets a Document had when it was made,
  // to tell whether it changed since.
  | {
      readonly kind: "create";
      readonly entryKind: TreeEntryKind;
      readonly entryId: EntryId;
      readonly parentId: ParentId;
      readonly name: string;
      readonly sheetCount: number;
    }
  | {
      readonly kind: "renameFolder";
      readonly folderId: FolderId;
      readonly from: string;
      readonly to: string;
    };

export type TreeStep = readonly TreeChange[];

export interface TreeHistory {
  // Collects what happens until the returned function is called into one step (nested
  // groups join the outer one). A change outside a group is a step of its own.
  group(): () => void;
  record(change: TreeChange): void;
  peekUndo(): TreeStep | null;
  // The step to undo / redo, moved to the other side; null when there is none.
  takeUndo(): TreeStep | null;
  takeRedo(): TreeStep | null;
  // The step just undone cannot be made again (what it deleted had changed).
  dropRedo(): void;
  clear(): void;
}

// `onStep`: told about every new step (not about the ones taken back or made again).
export function createTreeHistory(
  limit: number,
  onStep: (step: TreeStep) => void,
): TreeHistory {
  let undoSteps: readonly TreeStep[] = [];
  let redoSteps: readonly TreeStep[] = [];
  let openGroups = 0;
  let collected: TreeChange[] = [];

  function pushed(
    steps: readonly TreeStep[],
    step: TreeStep,
  ): readonly TreeStep[] {
    return [...steps, step].slice(-limit);
  }

  function recordStep(step: TreeStep): void {
    if (step.length === 0) return;
    undoSteps = pushed(undoSteps, step);
    redoSteps = [];
    onStep(step);
  }

  return {
    group() {
      openGroups += 1;
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        openGroups -= 1;
        if (openGroups > 0) return;
        const step = collected;
        collected = [];
        recordStep(step);
      };
    },
    record(change) {
      if (openGroups > 0) collected.push(change);
      else recordStep([change]);
    },
    peekUndo: () => undoSteps.at(-1) ?? null,
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
    dropRedo() {
      redoSteps = redoSteps.slice(0, -1);
    },
    clear() {
      undoSteps = [];
      redoSteps = [];
    },
  };
}
