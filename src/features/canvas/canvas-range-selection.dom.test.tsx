// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { settle } from "../../application/test-support/fakes";
import { SHEET_A1 } from "../../application/test-support/workspace-harness";
import {
  blockOption,
  canvasElement,
  type RenderedCanvas,
  renderOpenedCanvas,
} from "../markdown/test-support/markdown-harness";
import { getSelection } from "../workspace/ui-state/ui-state";

afterEach(() => {
  cleanup();
});

// Blocks (100 x 50): 1 at (10,20), 2 at (300,40), 3 at (0,200). jsdom has no layout, so
// client coordinates are canvas coordinates and the default viewport maps them to world.
const pointer = (
  x: number,
  y: number,
  extra: Record<string, unknown> = {},
) => ({ clientX: x, clientY: y, button: 0, pointerId: 1, ...extra });

const selectedLabels = () =>
  screen
    .getAllByRole("option")
    .filter((option) => option.getAttribute("aria-selected") === "true")
    .map((option) => option.getAttribute("aria-label"));

const viewportOf = (rendered: RenderedCanvas) =>
  rendered.shell.uiStateStore.getState().viewportBySheet.get(SHEET_A1);

async function dragOnCanvas(
  from: [number, number],
  to: [number, number],
  extra: Record<string, unknown> = {},
  target: HTMLElement = canvasElement(),
) {
  fireEvent.pointerDown(target, pointer(...from, extra));
  fireEvent.pointerMove(canvasElement(), pointer(...to, extra));
  await act(async () => {
    fireEvent.pointerUp(canvasElement(), pointer(...to, extra));
    await settle();
  });
}

describe("range selection", () => {
  it("selects blocks that the rectangle partially overlaps", async () => {
    await renderOpenedCanvas();
    await dragOnCanvas([200, 10], [320, 60]);
    expect(selectedLabels()).toEqual(["markdown 00000002"]);
  });

  it("selects contained blocks and blocks that are only touched", async () => {
    await renderOpenedCanvas();
    // Block 1 is contained; block 3's top edge (y = 200) is touched exactly.
    await dragOnCanvas([-5, 0], [150, 200]);
    expect(selectedLabels()).toEqual([
      "markdown 00000001",
      "markdown 00000003",
    ]);
  });

  it("works when dragged up and to the left", async () => {
    await renderOpenedCanvas();
    await dragOnCanvas([320, 60], [200, 10]);
    expect(selectedLabels()).toEqual(["markdown 00000002"]);
  });

  it("an empty range clears the selection", async () => {
    await renderOpenedCanvas();
    await dragOnCanvas([200, 10], [320, 60]);
    await dragOnCanvas([600, 500], [700, 560]);
    expect(selectedLabels()).toEqual([]);
  });

  it("toggles the hit blocks with Ctrl and with Shift", async () => {
    await renderOpenedCanvas();
    await dragOnCanvas([200, 10], [320, 60]);
    await dragOnCanvas([-5, 0], [150, 100], { ctrlKey: true });
    expect(selectedLabels()).toEqual([
      "markdown 00000001",
      "markdown 00000002",
    ]);
    await dragOnCanvas([200, 10], [320, 60], { shiftKey: true });
    expect(selectedLabels()).toEqual(["markdown 00000001"]);
  });

  it("draws a decorative rectangle only while dragging and never moves the viewport", async () => {
    const rendered = await renderOpenedCanvas();
    const before = viewportOf(rendered);
    fireEvent.pointerDown(canvasElement(), pointer(200, 10));
    expect(screen.queryByTestId("canvas-range-selection")).toBeNull();
    fireEvent.pointerMove(canvasElement(), pointer(320, 60));
    const rectangle = screen.getByTestId("canvas-range-selection");
    expect(rectangle.getAttribute("aria-hidden")).toBe("true");
    expect(rectangle.style.left).toBe("200px");
    expect(rectangle.style.width).toBe("120px");
    expect(viewportOf(rendered)).toBe(before);
    await act(async () => {
      fireEvent.pointerUp(canvasElement(), pointer(320, 60));
      await settle();
    });
    expect(screen.queryByTestId("canvas-range-selection")).toBeNull();
    expect(viewportOf(rendered)).toBe(before);
    expect(rendered.canvas.session.getState().history.canUndo).toBe(false);
  });

  it("Escape cancels it and keeps the selection", async () => {
    await renderOpenedCanvas();
    await dragOnCanvas([200, 10], [320, 60]);
    fireEvent.pointerDown(canvasElement(), pointer(-5, 0));
    fireEvent.pointerMove(canvasElement(), pointer(150, 200));
    fireEvent.keyDown(canvasElement(), { key: "Escape" });
    expect(screen.queryByTestId("canvas-range-selection")).toBeNull();
    await act(async () => {
      fireEvent.pointerUp(canvasElement(), pointer(150, 200));
      await settle();
    });
    expect(selectedLabels()).toEqual(["markdown 00000002"]);
  });

  it("a click on the empty canvas still clears the selection", async () => {
    await renderOpenedCanvas();
    await dragOnCanvas([200, 10], [320, 60]);
    await dragOnCanvas([600, 500], [600, 500]);
    expect(selectedLabels()).toEqual([]);
  });
});

describe("pan with Space or the middle button", () => {
  const spaceDown = () =>
    fireEvent.keyDown(canvasElement(), { key: " ", code: "Space" });
  const spaceUp = () =>
    fireEvent.keyUp(canvasElement(), { key: " ", code: "Space" });

  it("Space + drag on the empty canvas pans and selects nothing", async () => {
    const rendered = await renderOpenedCanvas();
    spaceDown();
    expect(canvasElement().className).toContain("canvas--pan-ready");
    await dragOnCanvas([400, 400], [370, 380]);
    expect(viewportOf(rendered)).toMatchObject({ panX: -30, panY: -20 });
    expect(selectedLabels()).toEqual([]);
    expect(
      getSelection(rendered.shell.uiStateStore.getState(), SHEET_A1).size,
    ).toBe(0);
  });

  it("Space + drag over a block pans: it neither selects nor moves the block", async () => {
    const rendered = await renderOpenedCanvas();
    spaceDown();
    await dragOnCanvas([45, 45], [15, 25], {}, blockOption(0));
    expect(viewportOf(rendered)).toMatchObject({ panX: -30, panY: -20 });
    expect(selectedLabels()).toEqual([]);
    expect(rendered.canvas.blocksOfSheetA1()[0]?.position).toEqual({
      x: 10,
      y: 20,
    });
    expect(rendered.canvas.session.getState().history.canUndo).toBe(false);
  });

  it("pans without changing an existing selection", async () => {
    const rendered = await renderOpenedCanvas();
    await dragOnCanvas([200, 10], [320, 60]);
    spaceDown();
    await dragOnCanvas([400, 400], [370, 380]);
    expect(viewportOf(rendered)).toMatchObject({ panX: -30 });
    expect(selectedLabels()).toEqual(["markdown 00000002"]);
  });

  it("releasing Space (key up or losing focus) restores range selection", async () => {
    const rendered = await renderOpenedCanvas();
    spaceDown();
    spaceUp();
    expect(canvasElement().className).not.toContain("canvas--pan-ready");
    await dragOnCanvas([200, 10], [320, 60]);
    expect(selectedLabels()).toEqual(["markdown 00000002"]);
    expect(viewportOf(rendered)).toMatchObject({ panX: 0, panY: 0 });

    spaceDown();
    fireEvent.blur(canvasElement(), { relatedTarget: null });
    expect(canvasElement().className).not.toContain("canvas--pan-ready");
    fireEvent.blur(window);
  });

  it("the middle button pans without selecting", async () => {
    const rendered = await renderOpenedCanvas();
    await dragOnCanvas([400, 400], [370, 380], { button: 1 });
    expect(viewportOf(rendered)).toMatchObject({ panX: -30, panY: -20 });
    expect(selectedLabels()).toEqual([]);
  });

  it("does not treat Space typed in an input inside the canvas as the modifier", async () => {
    await renderOpenedCanvas();
    const input = document.createElement("input");
    canvasElement().appendChild(input);
    expect(fireEvent.keyDown(input, { key: " ", code: "Space" })).toBe(true);
    expect(canvasElement().className).not.toContain("canvas--pan-ready");
  });

  it("the wheel still pans and Ctrl + wheel still zooms", async () => {
    const rendered = await renderOpenedCanvas();
    fireEvent.wheel(canvasElement(), { deltaX: 10, deltaY: 20 });
    expect(viewportOf(rendered)).toMatchObject({ panX: -10, panY: -20 });
    fireEvent.wheel(canvasElement(), { deltaY: -100, ctrlKey: true });
    expect(viewportOf(rendered)?.zoom).toBeGreaterThan(1);
  });
});
