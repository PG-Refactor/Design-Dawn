import { describe, expect, it } from "vitest";
import { settle } from "../../application/test-support/fakes";
import { TEST_AUTO_SAVE_DELAY_MS } from "../../application/test-support/session-harness";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import { selectBlocks } from "../workspace/ui-state/ui-state";
import type { AlignMode } from "./geometry/align";
import {
  BLOCK_ONE,
  BLOCK_THREE,
  BLOCK_TWO,
  type CanvasHarness,
  openedCanvasHarness,
} from "./test-support/canvas-harness";

// Seeded blocks (100 x 50): 1 at (10,20), 2 at (300,40), 3 at (0,200).
const ORIGINAL = [
  [10, 20],
  [300, 40],
  [0, 200],
];

const select = (harness: CanvasHarness, ...blockIds: (typeof BLOCK_ONE)[]) =>
  harness.uiStateStore.setState((state) =>
    selectBlocks(state, SHEET_A1, blockIds),
  );
const align = (harness: CanvasHarness, mode: AlignMode) =>
  harness.canvasActions.alignSelection({
    documentId: DOCUMENT_A,
    sheetId: SHEET_A1,
    mode,
  });
const positions = (harness: CanvasHarness) =>
  harness
    .blocksOfSheetA1()
    .map((block) => [block.position.x, block.position.y]);

describe("alignSelection", () => {
  it("is one move command: one history entry, exact undo and redo", async () => {
    const harness = await openedCanvasHarness();
    select(harness, BLOCK_ONE, BLOCK_TWO, BLOCK_THREE);
    const result = await align(harness, "alignLeft");
    expect(result.ok).toBe(true);
    expect(positions(harness)).toEqual([
      [0, 20],
      [0, 40],
      [0, 200],
    ]);
    expect(harness.session.getState().history.undoLabel).toBe("moveBlocks");
    expect(await harness.undoDepth()).toBe(1);

    await harness.session.undo();
    expect(positions(harness)).toEqual(ORIGINAL);
    await harness.session.redo();
    expect(positions(harness)).toEqual([
      [0, 20],
      [0, 40],
      [0, 200],
    ]);
  });

  it("changes only positions: sizes and z-order stay", async () => {
    const harness = await openedCanvasHarness();
    select(harness, BLOCK_ONE, BLOCK_THREE);
    await align(harness, "alignRight");
    expect(harness.blocksOfSheetA1().map((block) => block.blockId)).toEqual([
      BLOCK_ONE,
      BLOCK_TWO,
      BLOCK_THREE,
    ]);
    for (const block of harness.blocksOfSheetA1()) {
      expect(block.size).toEqual({ width: 100, height: 50 });
    }
    expect(positions(harness)).toEqual([
      [10, 20],
      [300, 40],
      [10, 200],
    ]);
  });

  it("aligns only the selected blocks", async () => {
    const harness = await openedCanvasHarness();
    select(harness, BLOCK_TWO, BLOCK_THREE);
    await align(harness, "alignTop");
    expect(positions(harness)).toEqual([
      [10, 20],
      [300, 40],
      [0, 40],
    ]);
  });

  it("creates no history entry when nothing changes", async () => {
    const harness = await openedCanvasHarness();
    select(harness, BLOCK_ONE, BLOCK_TWO, BLOCK_THREE);
    await align(harness, "alignLeft");
    const depth = await harness.undoDepth();
    const again = await align(harness, "alignLeft");
    expect(again.ok).toBe(true);
    expect(await harness.undoDepth()).toBe(depth);
  });

  it("does nothing with fewer than two selected blocks", async () => {
    const harness = await openedCanvasHarness();
    expect((await align(harness, "alignLeft")).ok).toBe(true);
    select(harness, BLOCK_ONE);
    expect((await align(harness, "alignLeft")).ok).toBe(true);
    expect(harness.session.getState().history.canUndo).toBe(false);
    expect(positions(harness)).toEqual(ORIGINAL);
  });

  it("is saved by the auto-save after its delay, once", async () => {
    const harness = await openedCanvasHarness();
    select(harness, BLOCK_ONE, BLOCK_TWO);
    await align(harness, "alignTop");
    expect(harness.gateway.methods("saveSheet")).toEqual([]);
    harness.scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(harness.gateway.methods("saveSheet")).toEqual(["saveSheet"]);
    expect(harness.session.getState().save.dirtySheetIds.size).toBe(0);
  });
});
