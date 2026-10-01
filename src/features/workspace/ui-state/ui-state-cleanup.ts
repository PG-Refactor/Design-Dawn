// Removes UI state that points at things the workspace removed. Pure functions like the
// rest of `ui-state.ts`; each returns the same state object when nothing referenced the
// removed entity, so unrelated UI state and its subscribers are left alone.

import type { DocumentId, SheetId } from "../../../domain/shared/entity-id";
import {
  createInitialUiState,
  type Interaction,
  type UiState,
} from "./ui-state";

const IDLE_INTERACTION: Interaction = { kind: "idle" };

function withoutKeys<Key, Value>(
  map: ReadonlyMap<Key, Value>,
  keys: ReadonlySet<Key>,
): ReadonlyMap<Key, Value> {
  if (![...keys].some((key) => map.has(key))) return map;
  const next = new Map(map);
  for (const key of keys) next.delete(key);
  return next;
}

function interactionTouches(
  interaction: Interaction,
  sheetIds: ReadonlySet<SheetId>,
): boolean {
  return interaction.kind !== "idle" && sheetIds.has(interaction.sheetId);
}

// Hover only ever points into the sheet being edited. When that sheet goes away the
// block id is unknown to this module, so the hover is cleared instead of pruned.
function removeSheetReferences(
  state: UiState,
  sheetIds: ReadonlySet<SheetId>,
  hoverBelongsToRemoved: boolean,
): UiState {
  const selectionBySheet = withoutKeys(state.selectionBySheet, sheetIds);
  const viewportBySheet = withoutKeys(state.viewportBySheet, sheetIds);
  const interaction = interactionTouches(state.interaction, sheetIds)
    ? IDLE_INTERACTION
    : state.interaction;
  const hoveredBlockId = hoverBelongsToRemoved ? null : state.hoveredBlockId;
  const editingBlock =
    state.editingBlock !== null && sheetIds.has(state.editingBlock.sheetId)
      ? null
      : state.editingBlock;
  if (
    selectionBySheet === state.selectionBySheet &&
    viewportBySheet === state.viewportBySheet &&
    interaction === state.interaction &&
    hoveredBlockId === state.hoveredBlockId &&
    editingBlock === state.editingBlock
  ) {
    return state;
  }
  return {
    ...state,
    selectionBySheet,
    viewportBySheet,
    interaction,
    hoveredBlockId,
    editingBlock,
  };
}

export function removeDocumentReferences(
  state: UiState,
  documentId: DocumentId,
  sheetIds: readonly SheetId[],
): UiState {
  const activeSheetId = state.activeSheetIdByDocument.get(documentId);
  const hoverBelongsToRemoved = state.activeDocumentId === documentId;
  let next = removeSheetReferences(
    state,
    new Set(sheetIds),
    hoverBelongsToRemoved,
  );
  if (activeSheetId !== undefined) {
    const activeSheetIdByDocument = new Map(next.activeSheetIdByDocument);
    activeSheetIdByDocument.delete(documentId);
    next = { ...next, activeSheetIdByDocument };
  }
  if (next.activeDocumentId === documentId) {
    next = { ...next, activeDocumentId: null };
  }
  return next;
}

export function removeSheetFromUiState(
  state: UiState,
  documentId: DocumentId,
  sheetId: SheetId,
): UiState {
  const wasActive = state.activeSheetIdByDocument.get(documentId) === sheetId;
  // Only the active sheet of the active document can be under the pointer.
  const hoverBelongsToRemoved =
    wasActive && state.activeDocumentId === documentId;
  let next = removeSheetReferences(
    state,
    new Set([sheetId]),
    hoverBelongsToRemoved,
  );
  if (wasActive) {
    const activeSheetIdByDocument = new Map(next.activeSheetIdByDocument);
    activeSheetIdByDocument.delete(documentId);
    next = { ...next, activeSheetIdByDocument };
  }
  return next;
}

// Everything in UI state belongs to the project that was open.
export function resetUiState(): UiState {
  return createInitialUiState();
}
