import { describe, expect, it } from "vitest";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import { CANVAS_CONFIG } from "../../config/canvas-config";
import { setViewport } from "../workspace/ui-state/ui-state";
import { createCanvasInput } from "./canvas-input";
import { clampViewport } from "./geometry/viewport-math";
import {
  BLOCK_ONE,
  BLOCK_THREE,
  type CanvasHarness,
  openedCanvasHarness,
} from "./test-support/canvas-harness";

const ORIGIN = { x: 100, y: 100 };
const { interval } = CANVAS_CONFIG.grid;

async function setup(zoom = 1) {
  const harness = await openedCanvasHarness();
  if (zoom !== 1) {
    harness.uiStateStore.setState((state) =>
      setViewport(state, SHEET_A1, clampViewport({ panX: 0, panY: 0, zoom })),
    );
  }
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
const screenAt = (worldDx: number, worldDy: number, zoom = 1) => ({
  x: ORIGIN.x + worldDx * zoom,
  y: ORIGIN.y + worldDy * zoom,
});
const dragDelta = (harness: CanvasHarness) => {
  const { interaction } = ui(harness);
  if (interaction.kind !== "dragging") throw new Error("dragging expected");
  return interaction.delta;
};
const positionOf = (harness: CanvasHarness, index: number) =>
  harness.blocksOfSheetA1()[index]?.position;

describe("grid snap of a move", () => {
  it("previews the snapped position and commits exactly that with one entry", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    input.pointerMove(screenAt(30, 10));
    // Block 1 is at (10, 20); (40, 30) snaps to (48, 24).
    expect(dragDelta(harness)).toEqual({ x: 38, y: 4 });
    await input.pointerUp();
    expect(positionOf(harness, 0)).toEqual({ x: 48, y: 24 });
    expect(await harness.undoDepth()).toBe(1);
  });

  it("moves a multi-selection as one box, preserving relative positions", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    await input.pointerUp();
    input.pointerDownOnBlock(BLOCK_THREE, ORIGIN, true);
    input.pointerMove(screenAt(15, 15));
    await input.pointerUp();
    // Box top-left (0, 20) + (15, 15) = (15, 35) -> (24, 24): delta (24, 4).
    expect(positionOf(harness, 0)).toEqual({ x: 34, y: 24 });
    expect(positionOf(harness, 2)).toEqual({ x: 24, y: 204 });
    expect(await harness.undoDepth()).toBe(1);
  });

  it("gives the same snapped result at every zoom", async () => {
    for (const zoom of [0.1, 1, 2, 8]) {
      const { harness, input } = await setup(zoom);
      input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
      input.pointerMove(screenAt(100, 50, zoom));
      await input.pointerUp();
      // (10, 20) + (100, 50) = (110, 70) -> (120, 72).
      expect(positionOf(harness, 0)).toEqual({ x: 120, y: 72 });
    }
  });

  it("snaps only on the grid interval from the config", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    input.pointerMove(screenAt(200, 200));
    const delta = dragDelta(harness);
    expect((10 + delta.x) % interval).toBe(0);
    expect((20 + delta.y) % interval).toBe(0);
    input.cancel();
  });
});

describe("Alt (snap suspended)", () => {
  it("shows and commits the unsnapped move while held", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    input.pointerMove(screenAt(30, 10), true);
    expect(dragDelta(harness)).toEqual({ x: 30, y: 10 });
    await input.pointerUp();
    expect(positionOf(harness, 0)).toEqual({ x: 40, y: 30 });
  });

  it("toggles mid-gesture from the last pointer position without any command", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    input.pointerMove(screenAt(30, 10));
    expect(dragDelta(harness)).toEqual({ x: 38, y: 4 });
    input.setSnapSuspended(true);
    expect(dragDelta(harness)).toEqual({ x: 30, y: 10 });
    input.setSnapSuspended(false);
    expect(dragDelta(harness)).toEqual({ x: 38, y: 4 });
    expect(harness.session.getState().history.canUndo).toBe(false);
    input.setSnapSuspended(true);
    await input.pointerUp();
    expect(positionOf(harness, 0)).toEqual({ x: 40, y: 30 });
    expect(await harness.undoDepth()).toBe(1);
  });

  it("is forgotten when the gesture ends", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    input.pointerMove(screenAt(30, 10), true);
    await input.pointerUp();
    input.pointerDownOnBlock(BLOCK_ONE, ORIGIN, false);
    input.pointerMove(screenAt(30, 10));
    // Block 1 is now at (40, 30): (70, 40) snaps to (72, 48), i.e. snapped again.
    expect(dragDelta(harness)).toEqual({ x: 32, y: 18 });
    input.cancel();
  });

  it("switches the resize preview too", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnResizeHandle(BLOCK_ONE, ORIGIN);
    input.pointerMove(screenAt(40, 25));
    expect(ui(harness).interaction).toMatchObject({
      kind: "resizing",
      frame: { x: 10, y: 20, width: 134, height: 76 },
    });
    input.setSnapSuspended(true);
    expect(ui(harness).interaction).toMatchObject({
      frame: { x: 10, y: 20, width: 140, height: 75 },
    });
    input.setSnapSuspended(false);
    await input.pointerUp();
    expect(harness.blocksOfSheetA1()[0]?.size).toEqual({
      width: 134,
      height: 76,
    });
    expect(await harness.undoDepth()).toBe(1);
  });

  it("does nothing outside a move or resize", async () => {
    const { harness, input } = await setup();
    input.setSnapSuspended(true);
    input.setSnapSuspended(false);
    expect(ui(harness).interaction).toEqual({ kind: "idle" });
  });
});

describe("grid snap of a resize", () => {
  it("previews the snapped size, keeps the position, commits one entry", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnResizeHandle(BLOCK_ONE, ORIGIN);
    input.pointerMove(screenAt(40, 25));
    expect(ui(harness).interaction).toMatchObject({
      frame: { x: 10, y: 20, width: 134, height: 76 },
    });
    await input.pointerUp();
    expect(harness.blocksOfSheetA1()[0]?.size).toEqual({
      width: 134,
      height: 76,
    });
    expect(positionOf(harness, 0)).toEqual({ x: 10, y: 20 });
    expect(await harness.undoDepth()).toBe(1);
  });

  it("is the same at every zoom and respects the minimum", async () => {
    for (const zoom of [0.1, 1, 2, 8]) {
      const { harness, input } = await setup(zoom);
      input.pointerDownOnResizeHandle(BLOCK_ONE, ORIGIN);
      input.pointerMove(screenAt(40, 25, zoom));
      expect(ui(harness).interaction).toMatchObject({
        frame: { width: 134, height: 76 },
      });
      input.pointerMove(screenAt(-5000, -5000, zoom));
      expect(ui(harness).interaction).toMatchObject({
        frame: CANVAS_CONFIG.block.minSize,
      });
      input.cancel();
    }
  });
});
