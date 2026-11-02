import { describe, expect, it } from "vitest";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
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

// Blocks (100 x 50): ONE at (10,20), TWO at (300,40), THREE at (0,200).
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

async function dragRange(
  input: ReturnType<typeof createCanvasInput>,
  from: { x: number; y: number },
  to: { x: number; y: number },
  additive = false,
) {
  input.pointerDownOnBackground(from, additive);
  input.pointerMove(to);
  await input.pointerUp();
}

describe("range selection", () => {
  it("selects blocks that the rectangle partially overlaps", async () => {
    const { harness, input } = await setup();
    await dragRange(input, { x: 200, y: 10 }, { x: 320, y: 60 });
    expect(selected(harness)).toEqual([BLOCK_TWO]);
  });

  it("selects fully contained blocks and blocks touched only at an edge", async () => {
    const { harness, input } = await setup();
    // ONE is contained; THREE's top edge (y = 200) is touched exactly.
    await dragRange(input, { x: -5, y: 0 }, { x: 150, y: 200 });
    expect(selected(harness)).toEqual([BLOCK_ONE, BLOCK_THREE]);
  });

  it("works in every drag direction", async () => {
    const { harness, input } = await setup();
    await dragRange(input, { x: 320, y: 60 }, { x: 200, y: 10 });
    expect(selected(harness)).toEqual([BLOCK_TWO]);
  });

  it("an empty range clears the selection when replacing", async () => {
    const { harness, input } = await setup();
    await dragRange(input, { x: 200, y: 10 }, { x: 320, y: 60 });
    await dragRange(input, { x: 500, y: 500 }, { x: 600, y: 600 });
    expect(selected(harness)).toEqual([]);
  });

  it("toggles each hit block with the additive modifier", async () => {
    const { harness, input } = await setup();
    await dragRange(input, { x: 200, y: 10 }, { x: 320, y: 60 });
    await dragRange(input, { x: -5, y: 0 }, { x: 320, y: 100 }, true);
    // TWO was selected and is hit again -> off; ONE is hit -> on.
    expect(selected(harness)).toEqual([BLOCK_ONE]);
  });

  it("shows the rectangle in UI state while dragging and removes it on release", async () => {
    const { harness, input } = await setup();
    input.pointerDownOnBackground({ x: 200, y: 10 });
    expect(ui(harness).interaction.kind).toBe("idle");
    input.pointerMove({ x: 320, y: 60 });
    expect(ui(harness).interaction).toMatchObject({
      kind: "rangeSelecting",
      sheetId: SHEET_A1,
      start: { x: 200, y: 10 },
      current: { x: 320, y: 60 },
      mode: "replace",
    });
    await input.pointerUp();
    expect(ui(harness).interaction.kind).toBe("idle");
  });

  it("stores the rectangle in world coordinates and never moves the viewport", async () => {
    const { harness, input } = await setup();
    const viewport = clampViewport({ panX: -100, panY: -50, zoom: 2 });
    harness.uiStateStore.setState((state) =>
      setViewport(state, SHEET_A1, viewport),
    );
    // Screen (120, 50) -> world ((120+100)/2, (50+50)/2) = (110, 50): inside ONE.
    input.pointerDownOnBackground({ x: 120, y: 50 });
    input.pointerMove({ x: 140, y: 70 });
    expect(ui(harness).interaction).toMatchObject({
      start: { x: 110, y: 50 },
      current: { x: 120, y: 60 },
    });
    await input.pointerUp();
    expect(selected(harness)).toEqual([BLOCK_ONE]);
    expect(ui(harness).viewportBySheet.get(SHEET_A1)).toBe(viewport);
  });

  it("Escape (cancel) leaves the selection unchanged", async () => {
    const { harness, input } = await setup();
    await dragRange(input, { x: 200, y: 10 }, { x: 320, y: 60 });
    input.pointerDownOnBackground({ x: -5, y: 0 });
    input.pointerMove({ x: 150, y: 200 });
    input.cancel();
    await input.pointerUp();
    expect(selected(harness)).toEqual([BLOCK_TWO]);
    expect(ui(harness).interaction.kind).toBe("idle");
  });

  it("a click without movement still clears the selection", async () => {
    const { harness, input } = await setup();
    await dragRange(input, { x: 200, y: 10 }, { x: 320, y: 60 });
    input.pointerDownOnBackground({ x: 500, y: 500 });
    await input.pointerUp();
    expect(selected(harness)).toEqual([]);
  });

  it("creates no history entry and does not pan", async () => {
    const { harness, input } = await setup();
    const viewport = ui(harness).viewportBySheet.get(SHEET_A1);
    await dragRange(input, { x: -5, y: 0 }, { x: 150, y: 200 });
    expect(harness.session.getState().history.canUndo).toBe(false);
    expect(ui(harness).viewportBySheet.get(SHEET_A1)).toBe(viewport);
  });
});

describe("pan gesture", () => {
  it("pans without touching the selection or starting a range", async () => {
    const { harness, input } = await setup();
    await dragRange(input, { x: 200, y: 10 }, { x: 320, y: 60 });
    input.pointerDownForPan({ x: 100, y: 100 });
    input.pointerMove({ x: 70, y: 90 });
    expect(ui(harness).interaction.kind).toBe("idle");
    expect(ui(harness).viewportBySheet.get(SHEET_A1)).toMatchObject({
      panX: -30,
      panY: -10,
    });
    await input.pointerUp();
    expect(selected(harness)).toEqual([BLOCK_TWO]);
  });
});
