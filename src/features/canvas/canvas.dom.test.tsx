// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { viewportKey } from "../../application/test-support/fake-viewport";
import { PROJECT_ID, settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import { CANVAS_CONFIG } from "../../config/canvas-config";
import {
  renderShell,
  type ShellHarness,
} from "../workspace/test-support/shell-harness";
import { getSelection } from "../workspace/ui-state/ui-state";
import { clampViewport } from "./geometry/viewport-math";
import {
  type CanvasHarness,
  seedCanvasDisk,
  withCanvasHelpers,
} from "./test-support/canvas-harness";

afterEach(() => {
  cleanup();
});

const { saveDelayMs } = CANVAS_CONFIG.viewport;

interface Rendered {
  readonly shell: ShellHarness;
  readonly canvas: CanvasHarness;
}

async function renderOpenedCanvas(): Promise<Rendered> {
  const shell = await renderShell({ seed: seedCanvasDisk });
  await shell.openProjectInUi();
  await shell.user.click(
    within(screen.getByRole("treeitem", { name: "Document A" })).getByText(
      "Document A",
    ),
  );
  await screen.findByRole("listbox", { name: "Sheet A1" });
  await act(settle);
  return { shell, canvas: withCanvasHelpers(shell) };
}

const canvasElement = (name = "Sheet A1") =>
  screen.getByRole("listbox", { name });
const blockOption = (index: number) =>
  screen.getAllByRole("option")[index] as HTMLElement;
const frameOf = (option: HTMLElement) => option.parentElement as HTMLElement;
const resizeHandle = (index: number) =>
  screen.getAllByRole("button", { name: /のサイズを変更/ })[
    index
  ] as HTMLElement;
const worldLayer = () => screen.getByTestId("canvas-world");

const pointer = (
  x: number,
  y: number,
  extra: Record<string, unknown> = {},
) => ({
  clientX: x,
  clientY: y,
  button: 0,
  pointerId: 1,
  ...extra,
});

// Held Alt = no grid snap; for tests that assert unsnapped values.
const ALT = { altKey: true };

async function drag(
  target: HTMLElement,
  from: [number, number],
  to: [number, number],
  extra: Record<string, unknown> = {},
) {
  fireEvent.pointerDown(target, pointer(...from, extra));
  fireEvent.pointerMove(canvasElement(), pointer(...to, extra));
  await act(async () => {
    fireEvent.pointerUp(canvasElement(), pointer(...to, extra));
    await settle();
  });
}

describe("rendering", () => {
  it("draws the active sheet's blocks at their world rectangles in array order", async () => {
    await renderOpenedCanvas();
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.getAttribute("aria-label"))).toEqual([
      "markdown 00000001",
      "markdown 00000002",
      "markdown 00000003",
    ]);
    const first = frameOf(blockOption(0));
    expect(first.style.left).toBe("10px");
    expect(first.style.top).toBe("20px");
    expect(first.style.width).toBe("100px");
    expect(first.style.height).toBe("50px");
    expect(frameOf(blockOption(1)).style.left).toBe("300px");
    // Markdown blocks show their rendered text (the placeholder is for other types).
    expect(
      within(blockOption(0)).getByRole("region", {
        name: "Markdownプレビュー（00000001）",
      }).textContent,
    ).toContain("text of");
    expect(worldLayer().style.transform).toBe("translate(0px, 0px) scale(1)");
    expect(canvasElement().getAttribute("tabindex")).toBe("0");
  });

  it("switches the blocks with the active sheet and document", async () => {
    const { shell } = await renderOpenedCanvas();
    await shell.user.click(screen.getByRole("tab", { name: "Sheet A2" }));
    expect(canvasElement("Sheet A2")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByLabelText("markdown 0000000b")).toBeTruthy();

    await shell.user.click(
      within(screen.getByRole("treeitem", { name: "Document B" })).getByText(
        "Document B",
      ),
    );
    expect(
      await screen.findByRole("listbox", { name: "Sheet B1" }),
    ).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("shows an empty state for a document without sheets", async () => {
    const { shell } = await renderOpenedCanvas();
    await act(async () => {
      await shell.actions.createDocument("Empty");
      await settle();
    });
    expect(screen.getByText(/表示できるSheetがありません/)).toBeTruthy();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("selection", () => {
  it("selects on click, toggles with Ctrl and clears on the empty canvas", async () => {
    const { shell } = await renderOpenedCanvas();
    const selection = () => [
      ...getSelection(shell.uiStateStore.getState(), SHEET_A1),
    ];
    const blocks =
      shell.store.getState().documents.get(DOCUMENT_A)?.sheets.get(SHEET_A1)
        ?.blocks ?? [];

    fireEvent.pointerDown(blockOption(0), pointer(5, 5));
    fireEvent.pointerUp(canvasElement(), pointer(5, 5));
    expect(blockOption(0).getAttribute("aria-selected")).toBe("true");
    expect(blockOption(1).getAttribute("aria-selected")).toBe("false");
    expect(selection()).toEqual([blocks[0]?.blockId]);

    fireEvent.pointerDown(blockOption(1), pointer(5, 5, { ctrlKey: true }));
    fireEvent.pointerUp(canvasElement(), pointer(5, 5));
    expect(selection()).toEqual([blocks[0]?.blockId, blocks[1]?.blockId]);

    fireEvent.pointerDown(canvasElement(), pointer(500, 500));
    fireEvent.pointerUp(canvasElement(), pointer(500, 500));
    expect(selection()).toEqual([]);
    expect(blockOption(0).getAttribute("aria-selected")).toBe("false");
  });
});

describe("drag", () => {
  it("changes only UI state while moving and commits one entry with rounded values", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    const before = shell.store.getState();

    fireEvent.pointerDown(blockOption(0), pointer(100, 100));
    fireEvent.pointerMove(canvasElement(), pointer(113.72, 100, ALT));
    expect(shell.store.getState()).toBe(before);
    expect(canvas.session.getState().history.canUndo).toBe(false);
    expect(frameOf(blockOption(0)).style.left).toBe("23.72px");

    await act(async () => {
      fireEvent.pointerUp(canvasElement(), pointer(113.72, 100));
      await settle();
    });
    expect(canvas.blocksOfSheetA1()[0]?.position).toEqual({ x: 24, y: 20 });
    expect(frameOf(blockOption(0)).style.left).toBe("24px");
    expect(await canvas.undoDepth()).toBe(1);
  });

  it("moves a multi-selection with one history entry", async () => {
    const { canvas } = await renderOpenedCanvas();
    fireEvent.pointerDown(blockOption(0), pointer(0, 0));
    fireEvent.pointerUp(canvasElement(), pointer(0, 0));
    fireEvent.pointerDown(blockOption(2), pointer(0, 0, { shiftKey: true }));
    fireEvent.pointerUp(canvasElement(), pointer(0, 0));

    await drag(blockOption(0), [0, 0], [30, 10], ALT);

    const positions = canvas.blocksOfSheetA1().map((block) => block.position);
    expect(positions).toEqual([
      { x: 40, y: 30 },
      { x: 300, y: 40 },
      { x: 30, y: 210 },
    ]);
    expect(await canvas.undoDepth()).toBe(1);
  });

  it("commits nothing on Escape", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    fireEvent.pointerDown(blockOption(0), pointer(0, 0));
    fireEvent.pointerMove(canvasElement(), pointer(60, 60));
    expect(shell.uiStateStore.getState().interaction.kind).toBe("dragging");

    fireEvent.keyDown(canvasElement(), { key: "Escape" });
    expect(shell.uiStateStore.getState().interaction.kind).toBe("idle");
    await act(async () => {
      fireEvent.pointerUp(canvasElement(), pointer(60, 60));
      await settle();
    });
    expect(canvas.blocksOfSheetA1()[0]?.position).toEqual({ x: 10, y: 20 });
    expect(canvas.session.getState().history.canUndo).toBe(false);
    expect(frameOf(blockOption(0)).style.left).toBe("10px");
  });
});

describe("resize", () => {
  it("resizes through the handle with one entry and never below the minimum", async () => {
    const { canvas } = await renderOpenedCanvas();
    fireEvent.pointerDown(resizeHandle(0), pointer(0, 0));
    fireEvent.pointerMove(canvasElement(), pointer(-5000, -5000, ALT));
    expect(frameOf(blockOption(0)).style.width).toBe(
      `${CANVAS_CONFIG.block.minSize.width}px`,
    );

    fireEvent.pointerMove(canvasElement(), pointer(40, 25, ALT));
    await act(async () => {
      fireEvent.pointerUp(canvasElement(), pointer(40, 25));
      await settle();
    });
    expect(canvas.blocksOfSheetA1()[0]?.size).toEqual({
      width: 140,
      height: 75,
    });
    expect(canvas.blocksOfSheetA1()[0]?.position).toEqual({ x: 10, y: 20 });
    expect(await canvas.undoDepth()).toBe(1);
  });
});

describe("keyboard", () => {
  it("deletes the selection as one undoable entry and Ctrl+Z restores it", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    fireEvent.pointerDown(blockOption(1), pointer(0, 0));
    fireEvent.pointerUp(canvasElement(), pointer(0, 0));

    await act(async () => {
      fireEvent.keyDown(canvasElement(), { key: "Delete" });
      await settle();
    });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(canvas.blocksOfSheetA1()).toHaveLength(2);
    expect(canvas.session.getState().history.undoLabel).toBe("deleteBlocks");
    expect(getSelection(shell.uiStateStore.getState(), SHEET_A1).size).toBe(0);

    await act(async () => {
      fireEvent.keyDown(canvasElement(), { key: "z", ctrlKey: true });
      await settle();
    });
    expect(screen.getAllByRole("option")).toHaveLength(3);

    await act(async () => {
      fireEvent.keyDown(canvasElement(), {
        key: "Z",
        ctrlKey: true,
        shiftKey: true,
      });
      await settle();
    });
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("ignores shortcuts typed into an input inside the canvas", async () => {
    const { canvas } = await renderOpenedCanvas();
    const input = document.createElement("input");
    canvasElement().appendChild(input);
    fireEvent.pointerDown(blockOption(0), pointer(0, 0));
    fireEvent.pointerUp(canvasElement(), pointer(0, 0));
    await act(async () => {
      fireEvent.keyDown(input, { key: "Delete" });
      await settle();
    });
    expect(canvas.blocksOfSheetA1()).toHaveLength(3);
  });
});

describe("pan, zoom and viewport persistence", () => {
  it("zooms at the pointer with Ctrl+wheel and pans with the plain wheel", async () => {
    const { shell } = await renderOpenedCanvas();
    fireEvent.wheel(canvasElement(), {
      deltaY: -100,
      ctrlKey: true,
      clientX: 200,
      clientY: 100,
    });
    const zoomed = shell.uiStateStore.getState().viewportBySheet.get(SHEET_A1);
    expect(zoomed?.zoom).toBeGreaterThan(1);
    expect(worldLayer().style.transform).toBe(
      `translate(${zoomed?.panX}px, ${zoomed?.panY}px) scale(${zoomed?.zoom})`,
    );

    fireEvent.wheel(canvasElement(), { deltaX: 10, deltaY: 20 });
    const panned = shell.uiStateStore.getState().viewportBySheet.get(SHEET_A1);
    expect(panned?.panX).toBeCloseTo((zoomed?.panX ?? 0) - 10, 9);
    expect(panned?.panY).toBeCloseTo((zoomed?.panY ?? 0) - 20, 9);
  });

  it("pans by dragging with the middle button and keeps Domain data untouched", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    await drag(canvasElement(), [400, 400], [430, 380], { button: 1 });
    expect(
      shell.uiStateStore.getState().viewportBySheet.get(SHEET_A1),
    ).toMatchObject({
      panX: 30,
      panY: -20,
    });
    expect(canvas.session.getState().history.canUndo).toBe(false);
  });

  it("saves the viewport debounced, once, and restores it when the sheet is shown again", async () => {
    const { shell } = await renderOpenedCanvas();
    for (let step = 0; step < 5; step += 1) {
      fireEvent.wheel(canvasElement(), { deltaY: 10 });
    }
    expect(shell.viewportGateway.saveCalls).toEqual([]);
    await act(async () => {
      shell.viewportScheduler.advance(saveDelayMs);
      await settle();
    });
    expect(shell.viewportGateway.saveCalls).toHaveLength(1);
    const saved = shell.viewportGateway.saveCalls[0]?.viewport;
    expect(saved?.panY).toBe(-50);

    // Closing the document drops its UI state; opening it again loads what was saved.
    await shell.user.click(
      screen.getByRole("button", { name: "Document Aを閉じる" }),
    );
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await shell.user.click(
      within(screen.getByRole("treeitem", { name: "Document A" })).getByText(
        "Document A",
      ),
    );
    await screen.findByRole("listbox", { name: "Sheet A1" });
    await waitFor(() =>
      expect(worldLayer().style.transform).toBe(
        `translate(${saved?.panX}px, ${saved?.panY}px) scale(${saved?.zoom})`,
      ),
    );
  });

  it("restores a saved viewport from the gateway", async () => {
    const saved = clampViewport({ panX: 70, panY: 30, zoom: 2 });
    const shell = await renderShell({
      seed: (harness) => {
        seedCanvasDisk(harness);
        harness.viewportGateway.storage.set(
          viewportKey(PROJECT_ID, DOCUMENT_A, SHEET_A1),
          saved,
        );
      },
    });
    await shell.openProjectInUi();
    await shell.user.click(
      within(screen.getByRole("treeitem", { name: "Document A" })).getByText(
        "Document A",
      ),
    );
    await screen.findByRole("listbox", { name: "Sheet A1" });
    await waitFor(() =>
      expect(worldLayer().style.transform).toBe(
        "translate(70px, 30px) scale(2)",
      ),
    );
    expect(shell.viewportGateway.saveCalls).toEqual([]);
  });
});
