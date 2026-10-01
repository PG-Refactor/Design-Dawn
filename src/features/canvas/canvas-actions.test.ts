import { describe, expect, it } from "vitest";
import { blockIdOf } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import { selectBlocks, setViewport } from "../workspace/ui-state/ui-state";
import { clampViewport } from "./geometry/viewport-math";
import {
  BLOCK_ONE,
  BLOCK_THREE,
  BLOCK_TWO,
  openedCanvasHarness,
} from "./test-support/canvas-harness";

function positions(harness: Awaited<ReturnType<typeof openedCanvasHarness>>) {
  return harness
    .blocksOfSheetA1()
    .map((block) => [block.blockId, block.position.x, block.position.y]);
}

const ORIGINAL_POSITIONS = [
  [BLOCK_ONE, 10, 20],
  [BLOCK_TWO, 300, 40],
  [BLOCK_THREE, 0, 200],
];

describe("commitDrag", () => {
  it("issues exactly one moveBlocks command and rounds the fractional delta", async () => {
    const harness = await openedCanvasHarness();
    const result = await harness.canvasActions.commitDrag({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockIds: [BLOCK_ONE],
      worldDelta: { x: 3.72, y: -0.4 },
    });
    expect(result.ok).toBe(true);
    expect(positions(harness)[0]).toEqual([BLOCK_ONE, 14, 20]);
    expect(harness.session.getState().history.undoLabel).toBe("moveBlocks");
    expect(await harness.undoDepth()).toBe(1);
  });

  it("moves a multi-block selection with one history entry; undo and redo restore it", async () => {
    const harness = await openedCanvasHarness();
    await harness.canvasActions.commitDrag({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockIds: [BLOCK_ONE, BLOCK_THREE],
      worldDelta: { x: 50, y: 25 },
    });
    expect(positions(harness)).toEqual([
      [BLOCK_ONE, 60, 45],
      [BLOCK_TWO, 300, 40],
      [BLOCK_THREE, 50, 225],
    ]);
    expect(await harness.undoDepth()).toBe(1);

    await harness.session.undo();
    expect(positions(harness)).toEqual(ORIGINAL_POSITIONS);
    await harness.session.redo();
    expect(positions(harness)[0]).toEqual([BLOCK_ONE, 60, 45]);
  });

  it("issues no command when the delta rounds to zero", async () => {
    const harness = await openedCanvasHarness();
    const result = await harness.canvasActions.commitDrag({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockIds: [BLOCK_ONE, BLOCK_TWO],
      worldDelta: { x: 0.4, y: -0.49 },
    });
    expect(result.ok).toBe(true);
    expect(harness.session.getState().history.canUndo).toBe(false);
    expect(positions(harness)).toEqual(ORIGINAL_POSITIONS);
  });

  it("changes nothing and records an error for an out-of-range position", async () => {
    const harness = await openedCanvasHarness();
    const result = await harness.canvasActions.commitDrag({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockIds: [BLOCK_ONE],
      worldDelta: { x: 3e9, y: 0 },
    });
    expect(result.ok).toBe(false);
    expect(harness.session.getState().history.canUndo).toBe(false);
    expect(positions(harness)).toEqual(ORIGINAL_POSITIONS);
    expect(harness.uiStateStore.getState().operationErrors).toMatchObject([
      { operation: "moveBlocks", error: { kind: "invalidPosition" } },
    ]);
  });

  it("records an error for a block that is not in the sheet", async () => {
    const harness = await openedCanvasHarness();
    const result = await harness.canvasActions.commitDrag({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockIds: [BLOCK_ONE, blockIdOf(999)],
      worldDelta: { x: 10, y: 10 },
    });
    expect(result.ok).toBe(false);
    expect(positions(harness)).toEqual(ORIGINAL_POSITIONS);
    expect(harness.session.getState().history.canUndo).toBe(false);
    expect(harness.uiStateStore.getState().operationErrors).toMatchObject([
      { operation: "moveBlocks", error: { kind: "entityNotFound" } },
    ]);
  });
});

describe("commitResize", () => {
  it("issues one resizeBlocks command with integer sizes; undo and redo work", async () => {
    const harness = await openedCanvasHarness();
    const result = await harness.canvasActions.commitResize({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockId: BLOCK_ONE,
      frame: { x: 10, y: 20, width: 140.6, height: 80.2 },
    });
    expect(result.ok).toBe(true);
    const resized = harness.blocksOfSheetA1()[0];
    expect(resized?.size).toEqual({ width: 141, height: 80 });
    expect(resized?.position).toEqual({ x: 10, y: 20 });
    expect(harness.session.getState().history.undoLabel).toBe("resizeBlocks");
    expect(await harness.undoDepth()).toBe(1);

    await harness.session.undo();
    expect(harness.blocksOfSheetA1()[0]?.size).toEqual({
      width: 100,
      height: 50,
    });
    await harness.session.redo();
    expect(harness.blocksOfSheetA1()[0]?.size).toEqual({
      width: 141,
      height: 80,
    });
  });

  it("issues no command when the size is unchanged after rounding", async () => {
    const harness = await openedCanvasHarness();
    await harness.canvasActions.commitResize({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockId: BLOCK_ONE,
      frame: { x: 10, y: 20, width: 100.3, height: 49.8 },
    });
    expect(harness.session.getState().history.canUndo).toBe(false);
  });

  it("rejects an out-of-range size without changing state or history", async () => {
    const harness = await openedCanvasHarness();
    const result = await harness.canvasActions.commitResize({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockId: BLOCK_ONE,
      frame: { x: 10, y: 20, width: 3e9, height: 50 },
    });
    expect(result.ok).toBe(false);
    expect(harness.blocksOfSheetA1()[0]?.size).toEqual({
      width: 100,
      height: 50,
    });
    expect(harness.session.getState().history.canUndo).toBe(false);
    expect(harness.uiStateStore.getState().operationErrors).toMatchObject([
      { operation: "resizeBlocks", error: { kind: "invalidSize" } },
    ]);
  });
});

describe("deleteSelection", () => {
  it("runs the existing delete command (one entry), prunes the selection and undo restores", async () => {
    const harness = await openedCanvasHarness();
    harness.uiStateStore.setState((state) =>
      selectBlocks(state, SHEET_A1, [BLOCK_ONE, BLOCK_TWO]),
    );
    const result = await harness.canvasActions.deleteSelection({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockIds: [BLOCK_ONE, BLOCK_TWO],
    });
    expect(result.ok).toBe(true);
    expect(harness.blocksOfSheetA1().map((block) => block.blockId)).toEqual([
      BLOCK_THREE,
    ]);
    expect(harness.session.getState().history.undoLabel).toBe("deleteBlocks");
    expect(
      harness.uiStateStore.getState().selectionBySheet.get(SHEET_A1),
    ).toBeUndefined();
    expect(await harness.undoDepth()).toBe(1);

    const undone = await harness.canvasActions.undo(DOCUMENT_A);
    expect(undone.ok).toBe(true);
    expect(positions(harness)).toEqual(ORIGINAL_POSITIONS);
    await harness.canvasActions.redo(DOCUMENT_A);
    expect(harness.blocksOfSheetA1()).toHaveLength(1);
  });

  it("does nothing for an empty selection", async () => {
    const harness = await openedCanvasHarness();
    const result = await harness.canvasActions.deleteSelection({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockIds: [],
    });
    expect(result.ok).toBe(true);
    expect(harness.session.getState().history.canUndo).toBe(false);
  });

  it("records a failed deletion and leaves state and history unchanged", async () => {
    const harness = await openedCanvasHarness();
    harness.gateway.failOn("readBlockContent", "ioError");
    const result = await harness.canvasActions.deleteSelection({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockIds: [BLOCK_ONE],
    });
    expect(result.ok).toBe(false);
    expect(harness.blocksOfSheetA1()).toHaveLength(3);
    expect(harness.session.getState().history.canUndo).toBe(false);
    expect(harness.uiStateStore.getState().operationErrors).toMatchObject([
      { operation: "deleteBlocks" },
    ]);
  });
});

describe("undo and redo", () => {
  it("treat an empty history as a successful no-op", async () => {
    const harness = await openedCanvasHarness();
    const result = await harness.canvasActions.undo(DOCUMENT_A);
    expect(result.ok).toBe(true);
    expect(harness.blocksOfSheetA1()).toHaveLength(3);
  });

  it("reports a document that is not open", async () => {
    const harness = await openedCanvasHarness();
    const result = await harness.canvasActions.undo(
      harness.store.getState().project?.documents[1]?.documentId ?? DOCUMENT_A,
    );
    expect(result.ok).toBe(false);
    expect(harness.uiStateStore.getState().operationErrors).toMatchObject([
      { operation: "undo", error: { kind: "notWritable" } },
    ]);
  });
});

describe("history and intermediate UI state", () => {
  it("does not grow when only UI state changes (preview, selection, viewport)", async () => {
    const harness = await openedCanvasHarness();
    harness.uiStateStore.setState((state) =>
      selectBlocks(state, SHEET_A1, [BLOCK_ONE]),
    );
    harness.uiStateStore.setState((state) =>
      setViewport(
        state,
        SHEET_A1,
        clampViewport({ panX: 10, panY: 10, zoom: 2 }),
      ),
    );
    expect(harness.session.getState().history.canUndo).toBe(false);
    expect(harness.gateway.methods("saveSheet", "saveDocument")).toEqual([]);
  });
});
