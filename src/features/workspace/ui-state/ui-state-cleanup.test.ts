import { describe, expect, it } from "vitest";
import { parseViewport } from "../../../application/local-state/viewport";
import { documentIdOf } from "../../../application/test-support/fakes";
import { createWorkspaceEvents } from "../../../application/workspace/workspace-events";
import {
  blockIdOf,
  DOCUMENT_ID,
  OTHER_SHEET_ID,
  PROJECT_ID,
  SHEET_ID,
} from "../../../domain/shared/test-fixtures";
import {
  createInitialUiState,
  createUiStateStore,
  selectBlocks,
  setActiveDocument,
  setActiveSheet,
  setHoveredBlock,
  setViewport,
  startDrag,
  startEditing,
  type UiState,
} from "./ui-state";
import {
  removeDocumentReferences,
  removeSheetFromUiState,
} from "./ui-state-cleanup";
import { connectWorkspaceToUiState } from "./workspace-ui-connector";

const parsedViewport = parseViewport({ panX: 1, panY: 2, zoom: 1 });
if (!parsedViewport.ok) throw new Error("fixture viewport is valid");
const viewport = parsedViewport.value;
const OTHER_DOCUMENT_ID = documentIdOf(5);

function populated(): UiState {
  let state = createInitialUiState();
  state = setActiveDocument(state, DOCUMENT_ID);
  state = setActiveSheet(state, DOCUMENT_ID, SHEET_ID);
  state = setActiveSheet(state, OTHER_DOCUMENT_ID, OTHER_SHEET_ID);
  state = selectBlocks(state, SHEET_ID, [blockIdOf(1)]);
  state = selectBlocks(state, OTHER_SHEET_ID, [blockIdOf(2)]);
  state = setViewport(state, SHEET_ID, viewport);
  state = setViewport(state, OTHER_SHEET_ID, viewport);
  state = setHoveredBlock(state, blockIdOf(1));
  return startDrag(state, SHEET_ID, [blockIdOf(1)]);
}

describe("removeSheetFromUiState", () => {
  it("drops every reference to the deleted active sheet", () => {
    const next = removeSheetFromUiState(populated(), DOCUMENT_ID, SHEET_ID);
    expect(next.activeSheetIdByDocument.has(DOCUMENT_ID)).toBe(false);
    expect(next.selectionBySheet.has(SHEET_ID)).toBe(false);
    expect(next.viewportBySheet.has(SHEET_ID)).toBe(false);
    expect(next.interaction).toEqual({ kind: "idle" });
    expect(next.hoveredBlockId).toBeNull();
  });

  it("leaves unrelated state untouched", () => {
    const next = removeSheetFromUiState(populated(), DOCUMENT_ID, SHEET_ID);
    expect(next.activeDocumentId).toBe(DOCUMENT_ID);
    expect(next.activeSheetIdByDocument.get(OTHER_DOCUMENT_ID)).toBe(
      OTHER_SHEET_ID,
    );
    expect(next.selectionBySheet.get(OTHER_SHEET_ID)).toEqual(
      new Set([blockIdOf(2)]),
    );
    expect(next.viewportBySheet.get(OTHER_SHEET_ID)).toBe(viewport);
  });

  it("keeps hover when another sheet is deleted, and the same state object when nothing matches", () => {
    const state = populated();
    const next = removeSheetFromUiState(
      state,
      OTHER_DOCUMENT_ID,
      OTHER_SHEET_ID,
    );
    expect(next.hoveredBlockId).toBe(blockIdOf(1));
    expect(next.interaction.kind).toBe("dragging");
    const empty = createInitialUiState();
    expect(removeSheetFromUiState(empty, DOCUMENT_ID, SHEET_ID)).toBe(empty);
  });
});

describe("removeDocumentReferences", () => {
  it("removes the document and all its sheets from UI state", () => {
    const next = removeDocumentReferences(populated(), DOCUMENT_ID, [SHEET_ID]);
    expect(next.activeDocumentId).toBeNull();
    expect(next.activeSheetIdByDocument.has(DOCUMENT_ID)).toBe(false);
    expect(next.selectionBySheet.has(SHEET_ID)).toBe(false);
    expect(next.viewportBySheet.has(SHEET_ID)).toBe(false);
    expect(next.interaction).toEqual({ kind: "idle" });
    expect(next.hoveredBlockId).toBeNull();
    expect(next.activeSheetIdByDocument.get(OTHER_DOCUMENT_ID)).toBe(
      OTHER_SHEET_ID,
    );
    expect(next.viewportBySheet.get(OTHER_SHEET_ID)).toBe(viewport);
  });

  it("keeps the active document when another one closes", () => {
    const next = removeDocumentReferences(populated(), OTHER_DOCUMENT_ID, [
      OTHER_SHEET_ID,
    ]);
    expect(next.activeDocumentId).toBe(DOCUMENT_ID);
    expect(next.hoveredBlockId).toBe(blockIdOf(1));
    expect(next.selectionBySheet.has(OTHER_SHEET_ID)).toBe(false);
  });
});

describe("editing block cleanup", () => {
  it("is dropped with the sheet or the document that contains it", () => {
    const editing = startEditing(populated(), SHEET_ID, blockIdOf(1));
    expect(
      removeSheetFromUiState(editing, DOCUMENT_ID, SHEET_ID).editingBlock,
    ).toBeNull();
    expect(
      removeDocumentReferences(editing, DOCUMENT_ID, [SHEET_ID]).editingBlock,
    ).toBeNull();
  });

  it("is kept when another sheet is removed", () => {
    const editing = startEditing(populated(), SHEET_ID, blockIdOf(1));
    expect(
      removeSheetFromUiState(editing, OTHER_DOCUMENT_ID, OTHER_SHEET_ID)
        .editingBlock,
    ).toEqual({ sheetId: SHEET_ID, blockId: blockIdOf(1) });
  });
});

describe("connectWorkspaceToUiState", () => {
  it("applies events to the UI store until disconnected", () => {
    const events = createWorkspaceEvents();
    const uiStore = createUiStateStore();
    uiStore.setState(populated());
    const disconnect = connectWorkspaceToUiState(events, uiStore);

    events.emit({
      type: "sheetDeleted",
      documentId: DOCUMENT_ID,
      sheetId: SHEET_ID,
    });
    expect(uiStore.getState().activeSheetIdByDocument.has(DOCUMENT_ID)).toBe(
      false,
    );
    expect(uiStore.getState().selectionBySheet.has(OTHER_SHEET_ID)).toBe(true);

    events.emit({
      type: "documentClosed",
      documentId: OTHER_DOCUMENT_ID,
      sheetIds: [OTHER_SHEET_ID],
    });
    expect(uiStore.getState().viewportBySheet.size).toBe(0);
    expect(uiStore.getState().activeDocumentId).toBe(DOCUMENT_ID);

    events.emit({ type: "projectClosed", projectId: PROJECT_ID });
    expect(uiStore.getState()).toEqual(createInitialUiState());

    disconnect();
    uiStore.setState(populated());
    events.emit({ type: "projectClosed", projectId: PROJECT_ID });
    expect(uiStore.getState().activeDocumentId).toBe(DOCUMENT_ID);
  });
});
