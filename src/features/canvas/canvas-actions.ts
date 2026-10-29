// What the canvas UI calls to change the document. Framework-free; together with
// `workspace-actions` the only UI module that reaches the Workspace / document sessions.
//
// One gesture is ONE existing application command, so one gesture is one undo step. No
// command type is defined here and no gateway is touched. Failures are returned AND
// recorded as operation errors (never swallowed); the session guarantees that a failed
// command leaves the data and the history unchanged.

import type { ClipboardPort } from "../../application/clipboard/clipboard";
import {
  copyBlocks,
  duplicateBlocks,
  pasteBlocksCommand,
  resolvePasteAssets,
  validateAssetBlocks,
} from "../../application/clipboard/copy-paste";
import type {
  BlockFrame,
  BlockMove,
} from "../../application/commands/block-commands";
import {
  moveBlocksCommand,
  type ReorderDirection,
  reorderBlocksCommand,
  resizeBlocksCommand,
} from "../../application/commands/block-commands";
import type {
  ApplicationCommand,
  AssetBlockSpec,
} from "../../application/commands/command";
import { editBlockContentCommand } from "../../application/commands/content-commands";
import {
  createBlocksCommand,
  deleteBlocksCommand,
} from "../../application/commands/file-backed-commands";
import { commitPosition, commitSize } from "../../application/commit-geometry";
import type { ApplyDiagramEditsOutcome } from "../../application/diagram/apply-diagram-edits";
import { applyValidatedDiagramOperation } from "../../application/diagram/apply-validated-diagram-operation";
import type { DiagramRenderCheck } from "../../application/diagram/diagram-render-check";
import type { IdGenerator } from "../../application/id-generator";
import {
  failWith,
  fromDomainResult,
  type OperationError,
  type OperationErrorKind,
  type OperationResult,
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import type { PersistenceGateway } from "../../application/ports/persistence-gateway";
import type { ApplicationStore } from "../../application/state/application-state";
import type { Workspace } from "../../application/workspace/workspace";
import { PASTE_OFFSET } from "../../config/canvas-config";
import type { Block } from "../../domain/block/block";
import type { BlockType } from "../../domain/block/block-type";
import type { DiagramOperation } from "../../domain/diagram/diagram-operation";
import type {
  BlockId,
  DocumentId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import type { Position, Size } from "../../domain/shared/geometry";
import { addOperationError } from "../workspace/ui-state/shell-ui-state";
import {
  type FramePreview,
  getSelection,
  type OperationLabel,
  pruneBlockReferences,
  selectBlocks,
  startEditing,
  type UiStateStore,
} from "../workspace/ui-state/ui-state";
import { isEditableBlockType } from "./block-capabilities";
import { findCreatableBlockType } from "./creatable-block-types";
import { type AlignMode, alignedMoves } from "./geometry/align";
import { pasteTarget } from "./geometry/paste-target";
import {
  DEFAULT_VIEWPORT,
  type Extent,
  type Point,
  visibleWorldRect,
} from "./geometry/viewport-math";

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

export interface CreateBlockInput {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly blockType: BlockType;
  // Size of the canvas element in screen pixels; the block is centred in what it shows.
  readonly viewportSize: Extent;
}

export interface CommitContentEditInput {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly blockId: BlockId;
  readonly text: string;
}

export interface ApplyDiagramOperationInput {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly blockId: BlockId;
  readonly operation: DiagramOperation;
  // Asks Mermaid whether the candidate text draws; built by the caller from its renderer.
  readonly renderCheck: DiagramRenderCheck;
}

export interface BeginBlockEditInput {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly blockId: BlockId;
}

export interface LoadSheetContentsInput {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
}

// Operations on the current selection of a sheet. The selection is read from UI state, so
// the keyboard and the toolbar share one code path.
export interface SelectionActionInput {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
}

export interface ReorderSelectionInput extends SelectionActionInput {
  readonly direction: ReorderDirection;
}

export interface AlignSelectionInput extends SelectionActionInput {
  readonly mode: AlignMode;
}

export interface PasteInput extends SelectionActionInput {
  // Size of the canvas element in screen pixels; a paste into another sheet is centred in
  // what it shows.
  readonly viewportSize: Extent;
}

export interface ImportDroppedImagesInput {
  // The drop Rust announced; the dropped paths never reach the Frontend.
  readonly dropId: string;
  // Size of the canvas element in screen pixels (zero when no canvas is shown).
  readonly viewportSize: Extent;
}

export interface CanvasActions {
  commitDrag(input: CommitDragInput): Promise<OperationResult<void>>;
  commitResize(input: CommitResizeInput): Promise<OperationResult<void>>;
  // Deleting blocks is undoable, so there is no confirmation (docs/requirements.md §12).
  deleteSelection(input: DeleteSelectionInput): Promise<OperationResult<void>>;
  // Changes the z-order of the selected blocks: one history entry, none when nothing moves.
  reorderSelection(
    input: ReorderSelectionInput,
  ): Promise<OperationResult<void>>;
  // Aligns the selected blocks to their bounding box: one move command (one history
  // entry) holding only the blocks that change; nothing happens with fewer than two
  // selected blocks or when they are already aligned.
  alignSelection(input: AlignSelectionInput): Promise<OperationResult<void>>;
  // Copy / cut / duplicate read block text from the application state, after waiting for
  // the sheet's contents to be loaded. Blocks whose text is not available are left out and
  // reported; they are never copied empty and a cut never deletes them.
  copySelection(input: SelectionActionInput): Promise<OperationResult<void>>;
  // Copy, then ONE delete command for exactly the copied blocks (one history entry).
  cutSelection(input: SelectionActionInput): Promise<OperationResult<void>>;
  // Pastes the clipboard into the sheet (one history entry) and selects the new blocks.
  pasteClipboard(input: PasteInput): Promise<OperationResult<void>>;
  duplicateSelection(
    input: SelectionActionInput,
  ): Promise<OperationResult<void>>;
  // Files dropped on the window: imports the images into the active Document's assets and
  // adds ONE image block per image (one history entry), then selects them. Rejected files
  // are reported one by one; without an active sheet nothing is imported.
  importDroppedImages(
    input: ImportDroppedImagesInput,
  ): Promise<OperationResult<void>>;
  // Adds one block of `blockType` (one history entry) and selects it.
  createBlock(input: CreateBlockInput): Promise<OperationResult<BlockId>>;
  // Reads the texts of the sheet's blocks (no history entry). Idempotent.
  loadSheetContents(
    input: LoadSheetContentsInput,
  ): Promise<OperationResult<void>>;
  // Opens the inline editor when the block has one and its text is loaded; false when it
  // cannot be edited (nothing changes then).
  beginBlockEdit(input: BeginBlockEditInput): boolean;
  // Makes the edited text the block's text: one history entry, none when it is unchanged.
  commitContentEdit(
    input: CommitContentEditInput,
  ): Promise<OperationResult<void>>;
  // One GUI operation on a Mermaid diagram: validated, drawn by the render check, then
  // committed as ONE content edit (one history entry; none when the text does not change).
  // A refusal of the operation itself (DIAGRAM_REFUSAL_KINDS) is returned for the GUI to
  // show next to the input and is NOT added to the operation notifications; any other
  // failure (document not open, block gone, content not loaded, a failed command) is
  // returned and recorded like every other action's.
  applyDiagramOperation(
    input: ApplyDiagramOperationInput,
  ): Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  undo(documentId: DocumentId): Promise<OperationResult<void>>;
  redo(documentId: DocumentId): Promise<OperationResult<void>>;
}

export interface CanvasActionsDependencies {
  readonly workspace: Workspace;
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
  readonly idGenerator: IdGenerator;
  // Only for assets, which exist BEFORE the command that references them: importing
  // dropped files and validating / copying images for copy and paste. Block content and
  // sheet metadata are written by the document session, never from here.
  readonly gateway: PersistenceGateway;
  // Shared by every sheet and document for the lifetime of the app.
  readonly clipboard: ClipboardPort;
}

const NOTHING_TO_DO = operationOk(undefined);

// Outcomes of a GUI operation that are the user's input or a concurrent change, not a
// malfunction: the GUI explains them inline, so a notification would say it twice.
const DIAGRAM_REFUSAL_KINDS: readonly OperationErrorKind[] = [
  "invalidDiagramOperation",
  "diagramNotEditable",
  "diagramMeaningMismatch",
  "diagramRenderRejected",
  "staleContent",
];

export function createCanvasActions(
  dependencies: CanvasActionsDependencies,
): CanvasActions {
  const {
    workspace,
    applicationStore,
    uiStateStore,
    idGenerator,
    gateway,
    clipboard,
  } = dependencies;

  function record<Value>(
    operation: OperationLabel,
    result: OperationResult<Value>,
  ): OperationResult<Value> {
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

  // Top-left of a new block of `size` that is centred in the visible world rectangle. When
  // a block already sits exactly there, the position steps by the paste offset until it
  // is free, so repeated additions fan out instead of stacking invisibly. `alsoTaken` are
  // positions of blocks of the same operation that are not on the sheet yet (several
  // images dropped at once).
  function newBlockPosition(
    input: Pick<CreateBlockInput, "documentId" | "sheetId" | "viewportSize">,
    size: Size,
    alsoTaken: readonly Position[] = [],
  ): OperationResult<Position> {
    const viewport =
      uiStateStore.getState().viewportBySheet.get(input.sheetId) ??
      DEFAULT_VIEWPORT;
    const visible = visibleWorldRect(input.viewportSize, viewport);
    const centred = commitPosition({
      x: visible.x + (visible.width - size.width) / 2,
      y: visible.y + (visible.height - size.height) / 2,
    });
    if (!centred.ok) return fromDomainResult(centred);
    const taken = [
      ...blocksOf(input.documentId, input.sheetId).map(
        (block) => block.position,
      ),
      ...alsoTaken,
    ];
    let position = centred.value;
    while (
      taken.some((other) => other.x === position.x && other.y === position.y)
    ) {
      const stepped = commitPosition({
        x: position.x + PASTE_OFFSET.x,
        y: position.y + PASTE_OFFSET.y,
      });
      if (!stepped.ok) return fromDomainResult(stepped);
      position = stepped.value;
    }
    return operationOk(position);
  }

  // Where a drop goes: the sheet on screen. Null without a project, document or sheet.
  function activeSheetTarget(): {
    readonly projectId: ProjectId;
    readonly documentId: DocumentId;
    readonly sheetId: SheetId;
  } | null {
    const projectId = currentProjectId();
    const { activeDocumentId, activeSheetIdByDocument } =
      uiStateStore.getState();
    if (projectId === null || activeDocumentId === null) return null;
    const sheetId = activeSheetIdByDocument.get(activeDocumentId);
    if (sheetId === undefined) return null;
    const open = documentData(activeDocumentId)?.sheets.has(sheetId) === true;
    return open ? { projectId, documentId: activeDocumentId, sheetId } : null;
  }

  function selectedBlockIds(
    documentId: DocumentId,
    sheetId: SheetId,
  ): readonly BlockId[] {
    const selection = getSelection(uiStateStore.getState(), sheetId);
    // Sheet order, so commands and copies follow the z-order.
    return blocksOf(documentId, sheetId)
      .map((block) => block.blockId)
      .filter((blockId) => selection.has(blockId));
  }

  // Reads the texts the copy needs through the session (its queue and gateway); once
  // loaded they are in the application state, which the copy reads. A failed load of
  // single blocks is not an error here: those blocks simply have no text and are skipped.
  async function ensureContentsLoaded(
    operation: OperationLabel,
    documentId: DocumentId,
    sheetId: SheetId,
  ): Promise<boolean> {
    const session = workspace.getDocumentSession(documentId);
    if (session === null) {
      record(
        operation,
        operationErr("notWritable", `document is not open: ${documentId}`),
      );
      return false;
    }
    return record(operation, await session.loadSheetContents(sheetId)).ok;
  }

  function documentData(documentId: DocumentId) {
    return applicationStore.getState().documents.get(documentId);
  }

  // Skipped blocks are reported through the operation errors: the count names how much
  // was left out; the kind is the first load failure, or "not found" when a text was
  // simply never read.
  function reportSkipped(
    operation: OperationLabel,
    documentId: DocumentId,
    skippedBlockIds: readonly BlockId[],
  ): void {
    if (skippedBlockIds.length === 0) return;
    const statuses = documentData(documentId)?.contentStatus;
    const failure = skippedBlockIds
      .map((blockId) => statuses?.get(blockId))
      .find((status) => status?.status === "failed");
    const error: OperationError =
      failure?.status === "failed"
        ? failure.error
        : {
            kind: "entityNotFound",
            detail: `block text is not loaded: ${skippedBlockIds.join(", ")}`,
          };
    uiStateStore.setState((state) =>
      addOperationError(
        state,
        operation,
        { blockCount: skippedBlockIds.length },
        error,
      ),
    );
  }

  // Blocks left out because their image asset could not be validated or copied: one entry
  // like `reportSkipped`, with the count as subject and the first failure as the error.
  function reportAssetFailures(
    operation: OperationLabel,
    errors: readonly OperationError[],
  ): void {
    const [first] = errors;
    if (first === undefined) return;
    uiStateStore.setState((state) =>
      addOperationError(state, operation, { blockCount: errors.length }, first),
    );
  }

  function currentProjectId() {
    return applicationStore.getState().project?.projectId ?? null;
  }

  // Image blocks of the selection that are not usable (their asset is missing or not an
  // image any more). Reported here; the copy / duplicate leaves them out.
  async function checkSelectedAssets(
    operation: OperationLabel,
    documentId: DocumentId,
    sheetId: SheetId,
    blockIds: readonly BlockId[],
  ): Promise<ReadonlyMap<BlockId, OperationError>> {
    const projectId = currentProjectId();
    const state = documentData(documentId);
    if (projectId === null || state === undefined) return new Map();
    const errors = await validateAssetBlocks({
      gateway,
      projectId,
      state,
      sheetId,
      blockIds,
    });
    reportAssetFailures(operation, [...errors.values()]);
    return errors;
  }

  // The part of copy / cut shared by both. Returns the copied block ids, or null when
  // nothing was copied (nothing selected, load or copy failed, no text available).
  async function copyForClipboard(
    operation: "copyBlocks" | "cutBlocks",
    { documentId, sheetId }: SelectionActionInput,
  ): Promise<readonly BlockId[] | null> {
    const blockIds = selectedBlockIds(documentId, sheetId);
    if (blockIds.length === 0) return null;
    if (!(await ensureContentsLoaded(operation, documentId, sheetId))) {
      return null;
    }
    const assetErrors = await checkSelectedAssets(
      operation,
      documentId,
      sheetId,
      blockIds,
    );
    // Read after the checks: the state may have moved while they ran.
    const state = documentData(documentId);
    if (state === undefined) return null;
    const copied = record(
      operation,
      copyBlocks({ state, sheetId, blockIds, clipboard, assetErrors }),
    );
    if (!copied.ok) return null;
    reportSkipped(operation, documentId, copied.value.skippedBlockIds);
    return copied.value.copiedBlockIds.length === 0
      ? null
      : copied.value.copiedBlockIds;
  }

  return {
    async reorderSelection({ documentId, sheetId, direction }) {
      const blockIds = selectedBlockIds(documentId, sheetId);
      if (blockIds.length === 0) return NOTHING_TO_DO;
      return execute(
        "reorderBlocks",
        documentId,
        reorderBlocksCommand(sheetId, blockIds, direction),
      );
    },

    async alignSelection({ documentId, sheetId, mode }) {
      const blockIds = new Set(selectedBlockIds(documentId, sheetId));
      if (blockIds.size < 2) return NOTHING_TO_DO;
      const moves = record(
        "moveBlocks",
        fromDomainResult(
          alignedMoves(
            blocksOf(documentId, sheetId).filter((block) =>
              blockIds.has(block.blockId),
            ),
            mode,
          ),
        ),
      );
      if (!moves.ok) return failWith(moves.error);
      if (moves.value.length === 0) return NOTHING_TO_DO;
      return execute(
        "moveBlocks",
        documentId,
        moveBlocksCommand(sheetId, moves.value),
      );
    },

    async copySelection(input) {
      await copyForClipboard("copyBlocks", input);
      return NOTHING_TO_DO;
    },

    async cutSelection(input) {
      const copiedBlockIds = await copyForClipboard("cutBlocks", input);
      if (copiedBlockIds === null) return NOTHING_TO_DO;
      // Exactly the copied blocks: the ones left out of the copy stay on the sheet.
      return execute(
        "cutBlocks",
        input.documentId,
        deleteBlocksCommand(input.sheetId, copiedBlockIds),
      );
    },

    async pasteClipboard({ documentId, sheetId, viewportSize }) {
      const copied = clipboard.read();
      if (copied === null) return NOTHING_TO_DO;
      const projectId = currentProjectId();
      if (projectId === null) {
        return record(
          "pasteBlocks",
          operationErr("projectNotOpen", "no project is open"),
        );
      }
      // Assets of another Document are copied first; blocks whose asset cannot be copied
      // are left out and reported, and an empty result creates nothing.
      const resolved = await resolvePasteAssets({
        gateway,
        projectId,
        content: copied,
        targetDocumentId: documentId,
      });
      reportAssetFailures("pasteBlocks", resolved.failures);
      if (resolved.content.blocks.length === 0) return NOTHING_TO_DO;
      const content = resolved.content;
      const sameSheet =
        content.source.documentId === documentId &&
        content.source.sheetId === sheetId;
      const viewport =
        uiStateStore.getState().viewportBySheet.get(sheetId) ??
        DEFAULT_VIEWPORT;
      const target = pasteTarget({
        content,
        sameSheet,
        visible: visibleWorldRect(viewportSize, viewport),
      });
      if (!target.ok) return record("pasteBlocks", fromDomainResult(target));
      const command = record(
        "pasteBlocks",
        pasteBlocksCommand({
          content,
          sheetId,
          target: target.value,
          idGenerator,
        }),
      );
      if (!command.ok) return failWith(command.error);
      const pasted = await execute("pasteBlocks", documentId, command.value);
      if (!pasted.ok) return pasted;
      uiStateStore.setState((state) =>
        selectBlocks(
          state,
          sheetId,
          command.value.specs.map((spec) => spec.blockId),
        ),
      );
      // Only when the clipboard still holds what was pasted (another copy may have
      // replaced it while the paste was waiting for its turn).
      if (sameSheet && clipboard.read() === copied) {
        clipboard.write({ ...copied, pasteCount: copied.pasteCount + 1 });
      }
      return pasted;
    },

    async duplicateSelection({ documentId, sheetId }) {
      const blockIds = selectedBlockIds(documentId, sheetId);
      if (blockIds.length === 0) return NOTHING_TO_DO;
      if (
        !(await ensureContentsLoaded("duplicateBlocks", documentId, sheetId))
      ) {
        return NOTHING_TO_DO;
      }
      const assetErrors = await checkSelectedAssets(
        "duplicateBlocks",
        documentId,
        sheetId,
        blockIds,
      );
      const state = documentData(documentId);
      if (state === undefined) return NOTHING_TO_DO;
      const duplicated = record(
        "duplicateBlocks",
        duplicateBlocks({ state, sheetId, blockIds, idGenerator, assetErrors }),
      );
      if (!duplicated.ok) return failWith(duplicated.error);
      reportSkipped(
        "duplicateBlocks",
        documentId,
        duplicated.value.skippedBlockIds,
      );
      const { command } = duplicated.value;
      if (command === null) return NOTHING_TO_DO;
      const created = await execute("duplicateBlocks", documentId, command);
      if (!created.ok) return created;
      uiStateStore.setState((state) =>
        selectBlocks(
          state,
          sheetId,
          command.specs.map((spec) => spec.blockId),
        ),
      );
      return created;
    },

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

    async createBlock(input) {
      const { documentId, sheetId, blockType } = input;
      const creatable = findCreatableBlockType(blockType);
      if (creatable === undefined) {
        return record(
          "createBlock",
          operationErr("unsupportedBlockType", `cannot create ${blockType}`),
        );
      }
      const size = commitSize(creatable.defaultSize);
      if (!size.ok) return record("createBlock", fromDomainResult(size));
      const position = newBlockPosition(input, size.value);
      if (!position.ok) return record("createBlock", position);
      const blockId = idGenerator.blockId();
      const created = await execute(
        "createBlock",
        documentId,
        createBlocksCommand(sheetId, [
          {
            blockId,
            blockType: creatable.blockType,
            position: position.value,
            size: size.value,
            text: creatable.initialText,
          },
        ]),
      );
      if (!created.ok) return failWith(created.error);
      uiStateStore.setState((state) => selectBlocks(state, sheetId, [blockId]));
      return operationOk(blockId);
    },

    async importDroppedImages({ dropId, viewportSize }) {
      const target = activeSheetTarget();
      if (target === null) {
        return record(
          "importImagesWithoutSheet",
          operationErr(
            "entityNotFound",
            "no sheet is open to receive the drop",
          ),
        );
      }
      const { projectId, documentId, sheetId } = target;
      const imported = record(
        "importImages",
        await gateway.importDroppedImages(dropId, projectId, documentId),
      );
      if (!imported.ok) return failWith(imported.error);
      // One entry per rejected file: the file name is the natural "subject" of each error
      // and the kinds differ per file (not an image, too large ...).
      for (const { fileName, error } of imported.value.rejected) {
        uiStateStore.setState((state) =>
          addOperationError(state, "importImages", fileName, error),
        );
      }
      const specs: AssetBlockSpec[] = [];
      for (const image of imported.value.imported) {
        // The returned initial size is used as it is: the UI minimum only limits resizing.
        const size = commitSize({
          width: image.initialWidth,
          height: image.initialHeight,
        });
        if (!size.ok) return record("importImages", fromDomainResult(size));
        const position = newBlockPosition(
          { documentId, sheetId, viewportSize },
          size.value,
          specs.map((spec) => spec.position),
        );
        if (!position.ok) return record("importImages", position);
        specs.push({
          blockId: idGenerator.blockId(),
          blockType: "image",
          position: position.value,
          size: size.value,
          contentPath: image.contentPath,
        });
      }
      if (specs.length === 0) return NOTHING_TO_DO;
      // The assets stay when the command fails: they are harmless files in assets/.
      const created = await execute(
        "importImages",
        documentId,
        createBlocksCommand(sheetId, specs),
      );
      if (!created.ok) return created;
      uiStateStore.setState((state) =>
        selectBlocks(
          state,
          sheetId,
          specs.map((spec) => spec.blockId),
        ),
      );
      return created;
    },

    async loadSheetContents({ documentId, sheetId }) {
      const session = workspace.getDocumentSession(documentId);
      if (session === null) {
        return record(
          "loadBlockContents",
          operationErr("notWritable", `document is not open: ${documentId}`),
        );
      }
      return record(
        "loadBlockContents",
        await session.loadSheetContents(sheetId),
      );
    },

    beginBlockEdit({ documentId, sheetId, blockId }) {
      const session = applicationStore.getState().documents.get(documentId);
      const block = session?.sheets
        .get(sheetId)
        ?.blocks.find((candidate) => candidate.blockId === blockId);
      if (session === undefined || block === undefined) return false;
      // Without loaded text there is nothing to edit: an editor over an unread (or
      // failed) file could later overwrite it with a made-up text.
      const loaded =
        session.contentStatus.get(blockId)?.status === "loaded" &&
        session.contents.has(blockId);
      if (!isEditableBlockType(block.blockType) || !loaded) return false;
      uiStateStore.setState((state) =>
        startEditing(selectBlocks(state, sheetId, [blockId]), sheetId, blockId),
      );
      return true;
    },

    commitContentEdit: ({ documentId, sheetId, blockId, text }) =>
      execute(
        "editBlockContent",
        documentId,
        editBlockContentCommand({ sheetId, blockId, text }),
      ),

    async applyDiagramOperation({
      documentId,
      sheetId,
      blockId,
      operation,
      renderCheck,
    }) {
      const session = workspace.getDocumentSession(documentId);
      if (session === null) {
        return record(
          "editDiagram",
          operationErr("notWritable", `document is not open: ${documentId}`),
        );
      }
      const result = await applyValidatedDiagramOperation(
        session,
        { documentId, sheetId, blockId, operation },
        renderCheck,
      );
      if (!result.ok && DIAGRAM_REFUSAL_KINDS.includes(result.error.kind)) {
        return result;
      }
      return record("editDiagram", result);
    },

    undo: (documentId) => history("undo", documentId),
    redo: (documentId) => history("redo", documentId),
  };
}
