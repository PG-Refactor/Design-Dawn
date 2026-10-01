// What the canvas UI calls to change the document. Framework-free; together with
// `workspace-actions` the only UI module that reaches the Workspace / document sessions.
//
// One gesture is ONE existing application command, so one gesture is one undo step. No
// command type is defined here and no gateway is touched. Failures are returned AND
// recorded as operation errors (never swallowed); the session guarantees that a failed
// command leaves the data and the history unchanged.

import type {
  BlockFrame,
  BlockMove,
} from "../../application/commands/block-commands";
import {
  moveBlocksCommand,
  resizeBlocksCommand,
} from "../../application/commands/block-commands";
import type { ApplicationCommand } from "../../application/commands/command";
import { deleteBlocksCommand } from "../../application/commands/file-backed-commands";
import { commitPosition, commitSize } from "../../application/commit-geometry";
import {
  fromDomainResult,
  type OperationResult,
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import type { ApplicationStore } from "../../application/state/application-state";
import type { Workspace } from "../../application/workspace/workspace";
import type { Block } from "../../domain/block/block";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../domain/shared/entity-id";
import { addOperationError } from "../workspace/ui-state/shell-ui-state";
import {
  type FramePreview,
  type OperationLabel,
  pruneBlockReferences,
  type UiStateStore,
} from "../workspace/ui-state/ui-state";
import type { Point } from "./geometry/viewport-math";

export interface CommitDragInput {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly blockIds: readonly BlockId[];
  // Fractional world distance the blocks were dragged.
  readonly worldDelta: Point;
}

export interface CommitResizeInput {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly blockId: BlockId;
  // Fractional preview frame; only its size is committed.
  readonly frame: FramePreview;
}

export interface DeleteSelectionInput {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly blockIds: readonly BlockId[];
}

export interface CanvasActions {
  commitDrag(input: CommitDragInput): Promise<OperationResult<void>>;
  commitResize(input: CommitResizeInput): Promise<OperationResult<void>>;
  // Deleting blocks is undoable, so there is no confirmation (docs/requirements.md §12).
  deleteSelection(input: DeleteSelectionInput): Promise<OperationResult<void>>;
  undo(documentId: DocumentId): Promise<OperationResult<void>>;
  redo(documentId: DocumentId): Promise<OperationResult<void>>;
}

export interface CanvasActionsDependencies {
  readonly workspace: Workspace;
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
}

const NOTHING_TO_DO = operationOk(undefined);

export function createCanvasActions(
  dependencies: CanvasActionsDependencies,
): CanvasActions {
  const { workspace, applicationStore, uiStateStore } = dependencies;

  function record(
    operation: OperationLabel,
    result: OperationResult<void>,
  ): OperationResult<void> {
    if (!result.ok) {
      const { error } = result;
      uiStateStore.setState((state) =>
        addOperationError(state, operation, null, error),
      );
    }
    return result;
  }

  function blocksOf(
    documentId: DocumentId,
    sheetId: SheetId,
  ): readonly Block[] {
    return (
      applicationStore.getState().documents.get(documentId)?.sheets.get(sheetId)
        ?.blocks ?? []
    );
  }

  // Selection / hover / interaction may point at blocks that an operation removed (a
  // delete, the undo of a create). History changes are not tied to one sheet, so every
  // sheet of the document is checked.
  function pruneDocumentReferences(documentId: DocumentId): void {
    const document = applicationStore.getState().documents.get(documentId);
    if (document === undefined) return;
    for (const [sheetId, sheet] of document.sheets) {
      const existing = new Set(sheet.blocks.map((block) => block.blockId));
      uiStateStore.setState((state) =>
        pruneBlockReferences(state, sheetId, existing),
      );
    }
  }

  async function execute(
    operation: OperationLabel,
    documentId: DocumentId,
    command: ApplicationCommand,
  ): Promise<OperationResult<void>> {
    const session = workspace.getDocumentSession(documentId);
    if (session === null) {
      return record(
        operation,
        operationErr("notWritable", `document is not open: ${documentId}`),
      );
    }
    const result = record(operation, await session.execute(command));
    pruneDocumentReferences(documentId);
    return result;
  }

  async function history(
    operation: "undo" | "redo",
    documentId: DocumentId,
  ): Promise<OperationResult<void>> {
    const session = workspace.getDocumentSession(documentId);
    if (session === null) {
      return record(
        operation,
        operationErr("notWritable", `document is not open: ${documentId}`),
      );
    }
    const result = record(
      operation,
      operation === "undo" ? await session.undo() : await session.redo(),
    );
    pruneDocumentReferences(documentId);
    return result;
  }

  return {
    async commitDrag({ documentId, sheetId, blockIds, worldDelta }) {
      const blocks = blocksOf(documentId, sheetId);
      const moves: BlockMove[] = [];
      for (const blockId of blockIds) {
        const block = blocks.find((candidate) => candidate.blockId === blockId);
        if (block === undefined) {
          return record(
            "moveBlocks",
            operationErr("entityNotFound", `block not found: ${blockId}`),
          );
        }
        const target = commitPosition({
          x: block.position.x + worldDelta.x,
          y: block.position.y + worldDelta.y,
        });
        if (!target.ok) return record("moveBlocks", fromDomainResult(target));
        // Blocks that do not change after rounding are left out of the command.
        if (
          target.value.x !== block.position.x ||
          target.value.y !== block.position.y
        ) {
          moves.push({ blockId, position: target.value });
        }
      }
      if (moves.length === 0) return NOTHING_TO_DO;
      return execute(
        "moveBlocks",
        documentId,
        moveBlocksCommand(sheetId, moves),
      );
    },

    async commitResize({ documentId, sheetId, blockId, frame }) {
      const block = blocksOf(documentId, sheetId).find(
        (candidate) => candidate.blockId === blockId,
      );
      if (block === undefined) {
        return record(
          "resizeBlocks",
          operationErr("entityNotFound", `block not found: ${blockId}`),
        );
      }
      const size = commitSize(frame);
      if (!size.ok) return record("resizeBlocks", fromDomainResult(size));
      if (
        size.value.width === block.size.width &&
        size.value.height === block.size.height
      ) {
        return NOTHING_TO_DO;
      }
      const resized: BlockFrame = {
        blockId,
        position: block.position,
        size: size.value,
      };
      return execute(
        "resizeBlocks",
        documentId,
        resizeBlocksCommand(sheetId, [resized]),
      );
    },

    async deleteSelection({ documentId, sheetId, blockIds }) {
      if (blockIds.length === 0) return NOTHING_TO_DO;
      return execute(
        "deleteBlocks",
        documentId,
        deleteBlocksCommand(sheetId, blockIds),
      );
    },

    undo: (documentId) => history("undo", documentId),
    redo: (documentId) => history("redo", documentId),
  };
}
