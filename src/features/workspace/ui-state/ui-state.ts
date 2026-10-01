// UI State (docs/architecture.md §8.1): selection, hover, in-progress drag / resize
// values, viewport and the active tab / sheet. Never saved with the Project, never part
// of undo history, never put into Domain values. A drag or resize lives here until it
// ends; only then does the UI hand ONE application command the committed values.
//
// Everything is a pure function on `UiState`; each returns the same state object when
// nothing changes so store listeners are not notified needlessly.

import type { Viewport } from "../../../application/local-state/viewport";
import type { OperationError } from "../../../application/ports/operation-error";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../../domain/shared/entity-id";
import { createStore, type Store } from "../../../shared/store/store";

// Fractional values are allowed here; they are rounded when committed.
export interface DragDelta {
  readonly x: number;
  readonly y: number;
}

export interface FramePreview {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type Interaction =
  | { readonly kind: "idle" }
  | {
      readonly kind: "dragging";
      readonly sheetId: SheetId;
      readonly blockIds: readonly BlockId[];
      readonly delta: DragDelta;
    }
  | {
      readonly kind: "resizing";
      readonly sheetId: SheetId;
      readonly blockId: BlockId;
      readonly frame: FramePreview;
    };

// The modal that is open (at most one). Confirmation states carry the entity name as it
// was when the user asked, so the text stays stable while the operation runs.
export type DialogState =
  | { readonly kind: "none" }
  | { readonly kind: "createProject" }
  | { readonly kind: "createDocument" }
  | { readonly kind: "createSheet"; readonly documentId: DocumentId }
  | {
      readonly kind: "confirmDeleteDocument";
      readonly documentId: DocumentId;
      readonly name: string;
    }
  | {
      readonly kind: "confirmDeleteSheet";
      readonly documentId: DocumentId;
      readonly sheetId: SheetId;
      readonly name: string;
    };

// The user-level operations that can fail and be reported (one value per message).
export const OPERATION_LABELS = [
  "selectFolder",
  "openProject",
  "createProject",
  "closeProject",
  "openDocument",
  "closeDocument",
  "createDocument",
  "createSheet",
  "deleteDocument",
  "deleteSheet",
  "moveBlocks",
  "resizeBlocks",
  "deleteBlocks",
  "createBlock",
  "editBlockContent",
  "loadBlockContents",
  "undo",
  "redo",
  "loadViewport",
  "saveViewport",
] as const;

export type OperationLabel = (typeof OPERATION_LABELS)[number];

// A failed operation, kept until the user dismisses it. Never swallowed: it is shown in
// the notifications.
export interface OperationErrorEntry {
  readonly id: number;
  readonly operation: OperationLabel;
  // Name of the entity the operation was about, when there was one.
  readonly subject: string | null;
  readonly error: OperationError;
}

// The block whose inline editor is open (at most one). Only WHICH block is edited lives
// here; the draft text is local to the editor and reaches the application only when the
// edit is committed.
export interface EditingBlock {
  readonly sheetId: SheetId;
  readonly blockId: BlockId;
}

export interface UiState {
  readonly activeDocumentId: DocumentId | null;
  readonly activeSheetIdByDocument: ReadonlyMap<DocumentId, SheetId>;
  readonly selectionBySheet: ReadonlyMap<SheetId, ReadonlySet<BlockId>>;
  readonly hoveredBlockId: BlockId | null;
  readonly interaction: Interaction;
  readonly editingBlock: EditingBlock | null;
  readonly viewportBySheet: ReadonlyMap<SheetId, Viewport>;
  readonly dialog: DialogState;
  readonly operationErrors: readonly OperationErrorEntry[];
  readonly nextOperationErrorId: number;
  readonly notificationsOpen: boolean;
  // A workspace operation is running; repeated clicks are disabled meanwhile.
  readonly busy: boolean;
}

export type UiStateStore = Store<UiState>;

const IDLE: Interaction = { kind: "idle" };
const NO_DIALOG: DialogState = { kind: "none" };

export function createInitialUiState(): UiState {
  return {
    activeDocumentId: null,
    activeSheetIdByDocument: new Map(),
    selectionBySheet: new Map(),
    hoveredBlockId: null,
    interaction: IDLE,
    editingBlock: null,
    viewportBySheet: new Map(),
    dialog: NO_DIALOG,
    operationErrors: [],
    nextOperationErrorId: 1,
    notificationsOpen: false,
    busy: false,
  };
}

export function createUiStateStore(): UiStateStore {
  return createStore(createInitialUiState());
}

export function getSelection(
  state: UiState,
  sheetId: SheetId,
): ReadonlySet<BlockId> {
  return state.selectionBySheet.get(sheetId) ?? EMPTY_SELECTION;
}

const EMPTY_SELECTION: ReadonlySet<BlockId> = new Set();

function sameMembers(
  first: ReadonlySet<BlockId>,
  second: ReadonlySet<BlockId>,
): boolean {
  return first.size === second.size && [...first].every((id) => second.has(id));
}

// An empty selection is stored as "no entry" so the map does not grow with sheets the
// user merely visited.
function withSelection(
  state: UiState,
  sheetId: SheetId,
  selection: ReadonlySet<BlockId>,
): UiState {
  if (sameMembers(getSelection(state, sheetId), selection)) return state;
  const selectionBySheet = new Map(state.selectionBySheet);
  if (selection.size === 0) {
    selectionBySheet.delete(sheetId);
  } else {
    selectionBySheet.set(sheetId, selection);
  }
  return { ...state, selectionBySheet };
}

export function selectBlocks(
  state: UiState,
  sheetId: SheetId,
  blockIds: readonly BlockId[],
): UiState {
  return withSelection(state, sheetId, new Set(blockIds));
}

export function toggleBlockSelection(
  state: UiState,
  sheetId: SheetId,
  blockId: BlockId,
): UiState {
  const selection = new Set(getSelection(state, sheetId));
  if (!selection.delete(blockId)) selection.add(blockId);
  return withSelection(state, sheetId, selection);
}

export function clearSelection(state: UiState, sheetId: SheetId): UiState {
  return withSelection(state, sheetId, EMPTY_SELECTION);
}

export function setHoveredBlock(
  state: UiState,
  blockId: BlockId | null,
): UiState {
  return state.hoveredBlockId === blockId
    ? state
    : { ...state, hoveredBlockId: blockId };
}

export function startDrag(
  state: UiState,
  sheetId: SheetId,
  blockIds: readonly BlockId[],
): UiState {
  return {
    ...state,
    interaction: {
      kind: "dragging",
      sheetId,
      blockIds,
      delta: { x: 0, y: 0 },
    },
  };
}

// Ignored unless a drag is in progress (a late pointer event after cancel).
export function updateDrag(state: UiState, delta: DragDelta): UiState {
  const { interaction } = state;
  if (interaction.kind !== "dragging") return state;
  return { ...state, interaction: { ...interaction, delta } };
}

export function startResize(
  state: UiState,
  sheetId: SheetId,
  blockId: BlockId,
  frame: FramePreview,
): UiState {
  return {
    ...state,
    interaction: { kind: "resizing", sheetId, blockId, frame },
  };
}

export function updateResize(state: UiState, frame: FramePreview): UiState {
  const { interaction } = state;
  if (interaction.kind !== "resizing") return state;
  return { ...state, interaction: { ...interaction, frame } };
}

// Ends or cancels a drag / resize. The caller reads `state.interaction` first when it
// needs the final values to commit.
export function endInteraction(state: UiState): UiState {
  return state.interaction.kind === "idle"
    ? state
    : { ...state, interaction: IDLE };
}

export function startEditing(
  state: UiState,
  sheetId: SheetId,
  blockId: BlockId,
): UiState {
  const { editingBlock } = state;
  if (editingBlock?.sheetId === sheetId && editingBlock.blockId === blockId) {
    return state;
  }
  return { ...state, editingBlock: { sheetId, blockId } };
}

// Only ends the edit of THIS block: a late "finished" from an editor that was already
// replaced by another one must not close the new one.
export function stopEditing(
  state: UiState,
  sheetId: SheetId,
  blockId: BlockId,
): UiState {
  const { editingBlock } = state;
  if (editingBlock?.sheetId !== sheetId || editingBlock.blockId !== blockId) {
    return state;
  }
  return { ...state, editingBlock: null };
}

// For when the canvas of a sheet goes away (another sheet is shown): whatever is edited
// there ends. The editor commits its own draft when it unmounts.
export function stopEditingSheet(state: UiState, sheetId: SheetId): UiState {
  return state.editingBlock?.sheetId === sheetId
    ? { ...state, editingBlock: null }
    : state;
}

export function setViewport(
  state: UiState,
  sheetId: SheetId,
  viewport: Viewport,
): UiState {
  if (state.viewportBySheet.get(sheetId) === viewport) return state;
  return {
    ...state,
    viewportBySheet: new Map(state.viewportBySheet).set(sheetId, viewport),
  };
}

export function setActiveDocument(
  state: UiState,
  documentId: DocumentId | null,
): UiState {
  return state.activeDocumentId === documentId
    ? state
    : { ...state, activeDocumentId: documentId };
}

export function setActiveSheet(
  state: UiState,
  documentId: DocumentId,
  sheetId: SheetId,
): UiState {
  if (state.activeSheetIdByDocument.get(documentId) === sheetId) return state;
  return {
    ...state,
    activeSheetIdByDocument: new Map(state.activeSheetIdByDocument).set(
      documentId,
      sheetId,
    ),
  };
}

// For when blocks of `sheetId` disappear (delete, undo of create): drops selected ids
// that no longer exist, clears a hover on a missing block (hover only ever points into
// the sheet being edited), and cancels an interaction that references a missing block.
export function pruneBlockReferences(
  state: UiState,
  sheetId: SheetId,
  existingBlockIds: ReadonlySet<BlockId>,
): UiState {
  const selection = getSelection(state, sheetId);
  const kept = [...selection].filter((id) => existingBlockIds.has(id));
  let next = withSelection(state, sheetId, new Set(kept));
  if (
    next.hoveredBlockId !== null &&
    !existingBlockIds.has(next.hoveredBlockId)
  ) {
    next = { ...next, hoveredBlockId: null };
  }
  if (referencesMissingBlock(next.interaction, sheetId, existingBlockIds)) {
    next = { ...next, interaction: IDLE };
  }
  const { editingBlock } = next;
  if (
    editingBlock?.sheetId === sheetId &&
    !existingBlockIds.has(editingBlock.blockId)
  ) {
    next = { ...next, editingBlock: null };
  }
  return next;
}

function referencesMissingBlock(
  interaction: Interaction,
  sheetId: SheetId,
  existingBlockIds: ReadonlySet<BlockId>,
): boolean {
  if (interaction.kind === "dragging") {
    return (
      interaction.sheetId === sheetId &&
      interaction.blockIds.some((id) => !existingBlockIds.has(id))
    );
  }
  if (interaction.kind === "resizing") {
    return (
      interaction.sheetId === sheetId &&
      !existingBlockIds.has(interaction.blockId)
    );
  }
  return false;
}
