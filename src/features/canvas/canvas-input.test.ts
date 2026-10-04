import { describe, expect, it } from "vitest";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import { CANVAS_CONFIG } from "../../config/canvas-config";
import { getSelection, setViewport } from "../workspace/ui-state/ui-state";
import { createCanvasInput } from "./canvas-input";
import { clampViewport } from "./geometry/viewport-math";
import {
  BLOCK_ONE,
  BLOCK_THREE,
  BLOCK_TWO,
  type CanvasHarness,
  openedCanvasHarness,
} from "./test-support/canvas-harness";

const ORIGIN = { x: 100, y: 100 };
const { dragThresholdPx } = CANVAS_CONFIG.interaction;

async function setup() {
  const harness = await openedCanvasHarness();
  const input = createCanvasInput({
    applicationStore: harness.store,
    uiStateStore: harness.uiStateStore,
    actions: harness.canvasActions,
    documentId: DOCUMENT_A,
    sheetId: SHEET_A1,
  });
  return { harness, input };
}

const ui = (harness: CanvasHarness) => harness.uiStateStore.getState();
const selected = (harness: CanvasHarness) => [
  ...getSelection(ui(harness), SHEET_A1),
];
const moveBy = (x: number, y: number) => ({ x: ORIGIN.x + x, y: ORIGIN.y + y });
const positionOf = (harness: CanvasHarness, index: number) =>
  harness.blocksOfSheetA1()[index]?.position;

describe("selection by click", () => {
  it("selects only the clicked block; a click on the background clears", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    await input.pointerUp();
    input.pointerDownOnBlock(BLOCK_TWO, ORIGIN, false);
    await input.pointerUp();
    expect(selected(harness)).toEqual([BLOCK_TWO]);

    input.pointerDownOnBackground(ORIGIN);
    await input.pointerUp();
    expect(selected(harness)).toEqual([]);
    expect(harness.session.getState().history.canUndo).toBe(false);
  });

  it("toggles with the additive modifier", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    await input.pointerUp();
    input.pointerDownOnBlock(BLOCK_TWO, ORIGIN, true);
    await input.pointerUp();
    expect(selected(harness)).toEqual([BLOCK_ONE, BLOCK_TWO]);
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, true);
    await input.pointerUp();
    expect(selected(harness)).toEqual([BLOCK_TWO]);
  });

  it("narrows a multi-selection on click but keeps it for a drag", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    await input.pointerUp();
    input.pointerDownOnBlock(BLOCK_TWO, ORIGIN, true);
    await input.pointerUp();

    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    expect(selected(harness)).toEqual([BLOCK_ONE, BLOCK_TWO]);
    input.pointerMove(moveBy(20, 0));
    await input.pointerUp();
    expect(selected(harness)).toEqual([BLOCK_ONE, BLOCK_TWO]);

    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    await input.pointerUp();
    expect(selected(harness)).toEqual([BLOCK_ONE]);
  });
});

describe("drag", () => {
  it("previews in UI state only and commits ONE command on release", async () => {
    const { harness, input } = await setup();
    const before = harness.store.getState();
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    input.pointerMove(moveBy(10.5, -3.25));
    input.pointerMove(moveBy(30.6, 5.4));

    const { interaction } = ui(harness);
    expect(interaction.kind).toBe("dragging");
    if (interaction.kind === "dragging") {
      expect(interaction.blockIds).toEqual([BLOCK_ONE]);
      expect(interaction.delta.x).toBeCloseTo(30.6, 9);
      expect(interaction.delta.y).toBeCloseTo(5.4, 9);
    }
    expect(harness.store.getState()).toBe(before);
    expect(harness.session.getState().history.canUndo).toBe(false);

    await input.pointerUp();
    expect(ui(harness).interaction).toEqual({ kind: "idle" });
    expect(positionOf(harness, 0)).toEqual({ x: 41, y: 25 });
    expect(await harness.undoDepth()).toBe(1);
  });

  it("keeps the preview until the command has run and ignores new gestures meanwhile", async () => {
    const { harness, input } = await setup();
    // Make the sheet dirty, then leave its save in flight so the next command must wait.
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    input.pointerMove(moveBy(30, 0));
    await input.pointerUp();
    const afterFirstDrag = positionOf(harness, 0);
    const releaseSave = harness.gateway.hold("saveSheet");
    const flushing = harness.session.flush();

    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    input.pointerMove(moveBy(50, 0));
    const committing = input.pointerUp();
    await Promise.resolve();

    // Still waiting: the preview is on screen and the domain value has not moved, so the
    // block is not shown back at its old position.
    expect(ui(harness).interaction.kind).toBe("dragging");
    expect(positionOf(harness, 0)).toEqual(afterFirstDrag);
    expect(input.isGestureActive()).toBe(true);
    input.pointerDownOnBlock(BLOCK_TWO, ORIGIN, false);
    expect(selected(harness)).toEqual([BLOCK_ONE]);

    releaseSave();
    await flushing;
    await committing;

    expect(ui(harness).interaction.kind).toBe("idle");
    expect(input.isGestureActive()).toBe(false);
    expect(positionOf(harness, 0)?.x).toBe((afterFirstDrag?.x ?? 0) + 50);
    expect(await harness.undoDepth()).toBe(2);
  });

  it("is a click, not a drag, within the threshold", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    input.pointerMove(moveBy(dragThresholdPx, 0));
    expect(ui(harness).interaction.kind).toBe("idle");
    await input.pointerUp();
    expect(harness.session.getState().history.canUndo).toBe(false);
  });

  it("moves the whole selection with one entry", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    await input.pointerUp();
    input.pointerDownOnBlock(BLOCK_THREE, ORIGIN, true);
    input.pointerMove(moveBy(15, 15));
    await input.pointerUp();
    expect(positionOf(harness, 0)).toEqual({ x: 25, y: 35 });
    expect(positionOf(harness, 1)).toEqual({ x: 300, y: 40 });
    expect(positionOf(harness, 2)).toEqual({ x: 15, y: 215 });
    expect(await harness.undoDepth()).toBe(1);
  });

  it("scales the pointer distance by the zoom", async () => {
    const { harness, input } = await setup();
    harness.uiStateStore.setState((state) =>
      setViewport(
        state,
        SHEET_A1,
        clampViewport({ panX: 50, panY: 50, zoom: 2 }),
      ),
    );
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    input.pointerMove(moveBy(40, 20));
    await input.pointerUp();
    expect(positionOf(harness, 0)).toEqual({ x: 30, y: 30 });
  });

  it("commits nothing when cancelled", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    input.pointerMove(moveBy(50, 50));
    input.cancel();
    expect(ui(harness).interaction).toEqual({ kind: "idle" });
    await input.pointerUp();
    input.pointerMove(moveBy(80, 80));
    expect(positionOf(harness, 0)).toEqual({ x: 10, y: 20 });
    expect(harness.session.getState().history.canUndo).toBe(false);
  });
});

describe("resize", () => {
  it("previews, clamps at the minimum and commits one command", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnResizeHandle(BLOCK_ONE, ORIGIN);
    input.pointerMove(moveBy(40, 25));
    expect(ui(harness).interaction).toMatchObject({
      kind: "resizing",
      frame: { x: 10, y: 20, width: 140, height: 75 },
    });
    input.pointerMove(moveBy(-5000, -5000));
    expect(ui(harness).interaction).toMatchObject({
      frame: CANVAS_CONFIG.block.minSize,
    });
    expect(harness.blocksOfSheetA1()[0]?.size).toEqual({
      width: 100,
      height: 50,
    });

    input.pointerMove(moveBy(40.4, 25.6));
    await input.pointerUp();
    expect(harness.blocksOfSheetA1()[0]?.size).toEqual({
      width: 140,
      height: 76,
    });
    expect(harness.session.getState().history.undoLabel).toBe("resizeBlocks");
    expect(await harness.undoDepth()).toBe(1);
  });

  it("commits nothing when cancelled", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnResizeHandle(BLOCK_ONE, ORIGIN);
    input.pointerMove(moveBy(40, 40));
    input.cancel();
    await input.pointerUp();
    expect(harness.session.getState().history.canUndo).toBe(false);
  });
});

describe("pan and wheel", () => {
  it("pans the viewport (UI state) on a pan drag and restores it on cancel", async () => {
    const { harness, input } = await setup();
    input.pointerDownForPan(ORIGIN);
    input.pointerMove(moveBy(30, -12));
    expect(ui(harness).viewportBySheet.get(SHEET_A1)).toMatchObject({
      panX: 30,
      panY: -12,
    });
    input.cancel();
    expect(ui(harness).viewportBySheet.get(SHEET_A1)).toMatchObject({
      panX: 0,
      panY: 0,
    });
  });

  it("keeps the selection after a pan", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    await input.pointerUp();
    input.pointerDownForPan(ORIGIN);
    input.pointerMove(moveBy(30, 30));
    await input.pointerUp();
    expect(selected(harness)).toEqual([BLOCK_ONE]);
  });

  it("pans with a plain wheel and zooms at the pointer with a modifier", async () => {
    const { harness, input } = await setup();
    input.wheel({ point: ORIGIN, deltaX: 10, deltaY: 30, zoom: false });
    expect(ui(harness).viewportBySheet.get(SHEET_A1)).toMatchObject({
      panX: -10,
      panY: -30,
      zoom: 1,
    });
    input.wheel({ point: ORIGIN, deltaX: 0, deltaY: -100, zoom: true });
    const zoomed = ui(harness).viewportBySheet.get(SHEET_A1);
    expect(zoomed?.zoom).toBeGreaterThan(1);
    // The world point under the pointer stays under it.
    const worldX = (ORIGIN.x - -10) / 1;
    expect(ORIGIN.x - (zoomed?.panX ?? 0)).toBeCloseTo(
      worldX * (zoomed?.zoom ?? 1),
      9,
    );
  });

  it("ignores the wheel during a gesture", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    input.pointerMove(moveBy(20, 0));
    input.wheel({ point: ORIGIN, deltaX: 0, deltaY: -100, zoom: true });
    expect(ui(harness).viewportBySheet.get(SHEET_A1)?.zoom).toBe(1);
    input.cancel();
  });
});

describe("blocks that disappear", () => {
  it("commits nothing when the dragged block was deleted during the drag", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    input.pointerMove(moveBy(20, 0));
    await harness.canvasActions.deleteSelection({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockIds: [BLOCK_ONE],
    });
    await input.pointerUp();
    expect(harness.session.getState().history.undoLabel).toBe("deleteBlocks");
    expect(await harness.undoDepth()).toBe(1);
  });
});
