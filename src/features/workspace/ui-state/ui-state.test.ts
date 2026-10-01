import { describe, expect, it } from "vitest";
import { parseViewport } from "../../../application/local-state/viewport";
import {
  blockIdOf,
  DOCUMENT_ID,
  OTHER_SHEET_ID,
  SHEET_ID,
} from "../../../domain/shared/test-fixtures";
import {
  clearSelection,
  createInitialUiState,
  createUiStateStore,
  endInteraction,
  getSelection,
  pruneBlockReferences,
  selectBlocks,
  setActiveDocument,
  setActiveSheet,
  setHoveredBlock,
  setViewport,
  startDrag,
  startResize,
  toggleBlockSelection,
  updateDrag,
  updateResize,
} from "./ui-state";

const first = blockIdOf(1);
const second = blockIdOf(2);
const third = blockIdOf(3);

function viewport(panX: number) {
  const parsed = parseViewport({ panX, panY: 0, zoom: 1 });
  if (!parsed.ok) throw new Error("fixture viewport is valid");
  return parsed.value;
}

describe("selection", () => {
  it("selects, toggles and clears per sheet", () => {
    let state = createInitialUiState();
    state = selectBlocks(state, SHEET_ID, [first, second]);
    expect([...getSelection(state, SHEET_ID)]).toEqual([first, second]);
    expect(getSelection(state, OTHER_SHEET_ID).size).toBe(0);
    state = toggleBlockSelection(state, SHEET_ID, second);
    state = toggleBlockSelection(state, SHEET_ID, third);
    expect([...getSelection(state, SHEET_ID)]).toEqual([first, third]);
    state = clearSelection(state, SHEET_ID);
    expect(getSelection(state, SHEET_ID).size).toBe(0);
    expect(state.selectionBySheet.has(SHEET_ID)).toBe(false);
  });

  it("returns the same state when nothing changes", () => {
    const state = selectBlocks(createInitialUiState(), SHEET_ID, [first]);
    expect(selectBlocks(state, SHEET_ID, [first])).toBe(state);
    expect(clearSelection(state, OTHER_SHEET_ID)).toBe(state);
    expect(setHoveredBlock(state, null)).toBe(state);
  });

  it("does not mutate previous states", () => {
    const before = selectBlocks(createInitialUiState(), SHEET_ID, [first]);
    toggleBlockSelection(before, SHEET_ID, second);
    expect([...getSelection(before, SHEET_ID)]).toEqual([first]);
  });
});

describe("interaction", () => {
  it("drags with fractional deltas and ends", () => {
    let state = startDrag(createInitialUiState(), SHEET_ID, [first, second]);
    expect(state.interaction).toMatchObject({
      kind: "dragging",
      delta: { x: 0, y: 0 },
    });
    state = updateDrag(state, { x: 10.5, y: -3.25 });
    expect(state.interaction).toMatchObject({ delta: { x: 10.5, y: -3.25 } });
    state = endInteraction(state);
    expect(state.interaction).toEqual({ kind: "idle" });
  });

  it("resizes with a fractional frame preview", () => {
    let state = startResize(createInitialUiState(), SHEET_ID, first, {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    state = updateResize(state, { x: 0.5, y: 0, width: 20.25, height: 10 });
    expect(state.interaction).toMatchObject({
      kind: "resizing",
      frame: { width: 20.25 },
    });
  });

  it("ignores updates when the matching interaction is not active", () => {
    const idle = createInitialUiState();
    expect(updateDrag(idle, { x: 1, y: 1 })).toBe(idle);
    expect(updateResize(idle, { x: 0, y: 0, width: 1, height: 1 })).toBe(idle);
    expect(endInteraction(idle)).toBe(idle);
    const resizing = startResize(idle, SHEET_ID, first, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    expect(updateDrag(resizing, { x: 1, y: 1 })).toBe(resizing);
  });
});

describe("viewport and active tabs", () => {
  it("stores a viewport per sheet", () => {
    const value = viewport(5);
    const state = setViewport(createInitialUiState(), SHEET_ID, value);
    expect(state.viewportBySheet.get(SHEET_ID)).toBe(value);
    expect(setViewport(state, SHEET_ID, value)).toBe(state);
  });

  it("tracks the active document and sheet", () => {
    let state = setActiveDocument(createInitialUiState(), DOCUMENT_ID);
    state = setActiveSheet(state, DOCUMENT_ID, SHEET_ID);
    expect(state.activeDocumentId).toBe(DOCUMENT_ID);
    expect(state.activeSheetIdByDocument.get(DOCUMENT_ID)).toBe(SHEET_ID);
    expect(setActiveSheet(state, DOCUMENT_ID, SHEET_ID)).toBe(state);
  });
});

describe("pruneBlockReferences", () => {
  it("drops selected ids that no longer exist", () => {
    const state = selectBlocks(createInitialUiState(), SHEET_ID, [
      first,
      second,
    ]);
    const pruned = pruneBlockReferences(state, SHEET_ID, new Set([first]));
    expect([...getSelection(pruned, SHEET_ID)]).toEqual([first]);
  });

  it("returns the same state when everything still exists", () => {
    const state = selectBlocks(createInitialUiState(), SHEET_ID, [first]);
    expect(
      pruneBlockReferences(state, SHEET_ID, new Set([first, second])),
    ).toBe(state);
  });

  it("clears hover and cancels an interaction that reference missing blocks", () => {
    let state = setHoveredBlock(createInitialUiState(), second);
    state = startDrag(state, SHEET_ID, [first, second]);
    const pruned = pruneBlockReferences(state, SHEET_ID, new Set([first]));
    expect(pruned.hoveredBlockId).toBeNull();
    expect(pruned.interaction).toEqual({ kind: "idle" });
  });

  it("leaves an interaction on another sheet alone", () => {
    const state = startDrag(createInitialUiState(), OTHER_SHEET_ID, [second]);
    expect(pruneBlockReferences(state, SHEET_ID, new Set())).toBe(state);
  });
});

describe("createUiStateStore", () => {
  it("starts idle with nothing selected", () => {
    const state = createUiStateStore().getState();
    expect(state.interaction).toEqual({ kind: "idle" });
    expect(state.selectionBySheet.size).toBe(0);
  });
});
