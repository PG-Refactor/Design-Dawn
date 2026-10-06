// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROJECT_ID, settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import { type Block, parseBlock } from "../../domain/block/block";
import { blockIdOf } from "../../domain/shared/test-fixtures";
import { unwrap } from "../../domain/shared/test-support";
import { seededBlocks } from "../canvas/test-support/canvas-harness";
import {
  blockOption,
  canvasElement,
  renderOpenedCanvas,
} from "../markdown/test-support/markdown-harness";
import { seedSheetBlocks } from "../workspace/test-support/actions-harness";
import { getSelection } from "../workspace/ui-state/ui-state";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-theme");
});

const pointer = (
  x: number,
  y: number,
  extra: Record<string, unknown> = {},
) => ({ clientX: x, clientY: y, button: 0, pointerId: 1, ...extra });
// Held Alt = no grid snap, so the committed values are the dragged ones.
const ALT = { altKey: true };

const NOTIFICATION_MESSAGE = /画像を読み込めませんでした/;
const PHOTO_COUNTER = 21;
const VECTOR_COUNTER = 22;
const PHOTO_PATH = "assets/photo.png";
const VECTOR_PATH = "assets/diagram.svg";

function imageBlock(counter: number, x: number, contentPath: string): Block {
  return unwrap(
    parseBlock({
      blockId: blockIdOf(counter),
      blockType: "image",
      position: { x, y: 300 },
      size: { width: 100, height: 50 },
      contentPath,
    }),
  );
}

// The three seeded markdown blocks plus two image blocks (indexes 3 and 4).
const PHOTO_INDEX = 3;
const VECTOR_INDEX = 4;

async function renderWithImages() {
  return renderOpenedCanvas((harness) => {
    seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, [
      ...seededBlocks(),
      imageBlock(PHOTO_COUNTER, 400, PHOTO_PATH),
      imageBlock(VECTOR_COUNTER, 600, VECTOR_PATH),
    ]);
  });
}

const imageOf = (option: HTMLElement) =>
  within(option).getByRole("img") as HTMLImageElement;
const shortId = (counter: number) => blockIdOf(counter).slice(-8);

describe("rendering", () => {
  it("shows an <img> over the resolver URL, filling the block, not draggable", async () => {
    await renderWithImages();
    const image = imageOf(blockOption(PHOTO_INDEX));
    expect(image.getAttribute("src")).toBe(
      `test-asset://${PROJECT_ID}/${DOCUMENT_A}/${PHOTO_PATH}`,
    );
    expect(image.getAttribute("alt")).toBe(`画像（${shortId(PHOTO_COUNTER)}）`);
    expect(image.getAttribute("draggable")).toBe("false");
    expect(image.className).toBe("image-block__picture");
    // No inline style: sizing and colours come from the stylesheet and its tokens.
    expect(image.hasAttribute("style")).toBe(false);
    expect(image.parentElement?.hasAttribute("style")).toBe(false);
  });

  it("never inlines an SVG: an .svg asset is an <img>, with no markup and no fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await renderWithImages();
      const option = blockOption(VECTOR_INDEX);
      expect(imageOf(option).getAttribute("src")).toMatch(/diagram\.svg$/);
      expect(option.querySelector("svg")).toBeNull();
      expect(document.querySelector("canvas svg, .image-block svg")).toBeNull();
      expect(option.querySelectorAll("*")).toHaveLength(2);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders the same, token-only markup under the Light and Dark themes", async () => {
    for (const theme of ["light", "dark"]) {
      document.documentElement.setAttribute("data-theme", theme);
      await renderWithImages();
      const image = imageOf(blockOption(PHOTO_INDEX));
      expect(image.closest(".image-block")?.hasAttribute("style")).toBe(false);
      expect(image.hasAttribute("style")).toBe(false);
      cleanup();
    }
  });
});

describe("interaction", () => {
  it("is selected on click and not editable", async () => {
    const { shell } = await renderWithImages();
    const option = blockOption(PHOTO_INDEX);
    fireEvent.pointerDown(option, pointer(5, 5));
    fireEvent.pointerUp(canvasElement(), pointer(5, 5));
    expect(option.getAttribute("aria-selected")).toBe("true");
    fireEvent.doubleClick(option);
    fireEvent.keyDown(canvasElement(), { key: "Enter" });
    expect(shell.uiStateStore.getState().editingBlock).toBeNull();
  });

  it("moves with one history entry", async () => {
    const { canvas } = await renderWithImages();
    fireEvent.pointerDown(blockOption(PHOTO_INDEX), pointer(410, 310));
    fireEvent.pointerMove(canvasElement(), pointer(434, 334, ALT));
    await act(async () => {
      fireEvent.pointerUp(canvasElement(), pointer(434, 334));
      await settle();
    });
    const moved = canvas.blocksOfSheetA1()[PHOTO_INDEX];
    expect(moved?.position).toEqual({ x: 424, y: 324 });
    expect(await canvas.undoDepth()).toBe(1);
  });

  it("resizes freely with one history entry", async () => {
    const { canvas } = await renderWithImages();
    const handle = screen.getAllByRole("button", {
      name: /のサイズを変更/,
    })[PHOTO_INDEX] as HTMLElement;
    fireEvent.pointerDown(handle, pointer(500, 350));
    fireEvent.pointerMove(canvasElement(), pointer(548, 362));
    await act(async () => {
      fireEvent.pointerUp(canvasElement(), pointer(548, 362));
      await settle();
    });
    const resized = canvas.blocksOfSheetA1()[PHOTO_INDEX];
    // Width and height change independently (no aspect-ratio lock).
    expect(resized?.size.width).toBeGreaterThan(100);
    expect(resized?.size.height).not.toBe(
      Math.round(((resized?.size.width ?? 0) * 50) / 100),
    );
    expect(await canvas.undoDepth()).toBe(1);
  });

  it("deletes with Delete, keeps the asset, and undo brings the block back", async () => {
    const { shell, canvas } = await renderWithImages();
    shell.gateway.seedAsset(DOCUMENT_A, PHOTO_PATH);
    fireEvent.pointerDown(blockOption(PHOTO_INDEX), pointer(410, 310));
    fireEvent.pointerUp(canvasElement(), pointer(410, 310));
    await act(async () => {
      fireEvent.keyDown(canvasElement(), { key: "Delete" });
      await settle();
    });
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(shell.gateway.hasAsset(DOCUMENT_A, PHOTO_PATH)).toBe(true);
    await act(async () => {
      await canvas.session.undo();
      await settle();
    });
    expect(screen.getAllByRole("option")).toHaveLength(5);
    expect(imageOf(blockOption(PHOTO_INDEX)).getAttribute("src")).toContain(
      PHOTO_PATH,
    );
  });

  it("supports multi-select and range-select together with other blocks", async () => {
    const { shell } = await renderWithImages();
    const selection = () => [
      ...getSelection(shell.uiStateStore.getState(), SHEET_A1),
    ];
    fireEvent.pointerDown(blockOption(PHOTO_INDEX), pointer(410, 310));
    fireEvent.pointerUp(canvasElement(), pointer(410, 310));
    fireEvent.pointerDown(
      blockOption(VECTOR_INDEX),
      pointer(610, 310, { ctrlKey: true }),
    );
    fireEvent.pointerUp(canvasElement(), pointer(610, 310));
    expect(selection()).toEqual([
      blockIdOf(PHOTO_COUNTER),
      blockIdOf(VECTOR_COUNTER),
    ]);
    // A marquee over the empty area around both images selects both.
    fireEvent.pointerDown(canvasElement(), pointer(380, 280));
    fireEvent.pointerMove(canvasElement(), pointer(720, 380));
    await act(async () => {
      fireEvent.pointerUp(canvasElement(), pointer(720, 380));
      await settle();
    });
    expect(selection()).toEqual([
      blockIdOf(PHOTO_COUNTER),
      blockIdOf(VECTOR_COUNTER),
    ]);
  });
});

describe("load failure", () => {
  it("shows an error state with the path, lists a warning, and clears it after a later load", async () => {
    const { shell } = await renderWithImages();
    const option = blockOption(PHOTO_INDEX);
    fireEvent.error(imageOf(option));
    expect(within(option).getByText("画像を読み込めません")).toBeTruthy();
    expect(within(option).getByText(/assets\/photo\.png/)).toBeTruthy();
    expect(within(option).queryByRole("img")).toBeNull();
    expect([
      ...(shell.uiStateStore.getState().imageLoadFailures.get(SHEET_A1) ?? []),
    ]).toEqual([blockIdOf(PHOTO_COUNTER)]);
    // The fixture document already has unrelated notifications, so the panel is checked
    // for this warning's own message.
    act(() => shell.actions.setNotificationsOpen(true));
    expect(screen.getByText(NOTIFICATION_MESSAGE)).toBeTruthy();

    // Coming back to the sheet tries again; a successful load clears the entry.
    await shell.user.click(screen.getByRole("tab", { name: "Sheet A2" }));
    await shell.user.click(screen.getByRole("tab", { name: "Sheet A1" }));
    await act(settle);
    fireEvent.load(imageOf(blockOption(PHOTO_INDEX)));
    expect(shell.uiStateStore.getState().imageLoadFailures.size).toBe(0);
    expect(screen.queryByText(NOTIFICATION_MESSAGE)).toBeNull();
  });

  it("keeps the failed block selectable and deletable", async () => {
    await renderWithImages();
    fireEvent.error(imageOf(blockOption(PHOTO_INDEX)));
    fireEvent.pointerDown(blockOption(PHOTO_INDEX), pointer(410, 310));
    fireEvent.pointerUp(canvasElement(), pointer(410, 310));
    expect(blockOption(PHOTO_INDEX).getAttribute("aria-selected")).toBe("true");
    await act(async () => {
      fireEvent.keyDown(canvasElement(), { key: "Delete" });
      await settle();
    });
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("shows the error state for a block restored by undo whose asset is gone", async () => {
    const { shell, canvas } = await renderWithImages();
    // No asset is seeded for the document: the file is gone from the start.
    expect(shell.gateway.hasAsset(DOCUMENT_A, PHOTO_PATH)).toBe(false);
    fireEvent.pointerDown(blockOption(PHOTO_INDEX), pointer(410, 310));
    fireEvent.pointerUp(canvasElement(), pointer(410, 310));
    await act(async () => {
      fireEvent.keyDown(canvasElement(), { key: "Delete" });
      await settle();
    });
    await act(async () => {
      await canvas.session.undo();
      await settle();
    });
    const option = blockOption(PHOTO_INDEX);
    fireEvent.error(imageOf(option));
    expect(within(option).getByText("画像を読み込めません")).toBeTruthy();
    expect(within(option).queryByRole("img")).toBeNull();
    expect([
      ...(shell.uiStateStore.getState().imageLoadFailures.get(SHEET_A1) ?? []),
    ]).toEqual([blockIdOf(PHOTO_COUNTER)]);
  });

  it("drops the failure record with the deleted block", async () => {
    const { shell } = await renderWithImages();
    fireEvent.error(imageOf(blockOption(PHOTO_INDEX)));
    fireEvent.pointerDown(blockOption(PHOTO_INDEX), pointer(410, 310));
    fireEvent.pointerUp(canvasElement(), pointer(410, 310));
    await act(async () => {
      fireEvent.keyDown(canvasElement(), { key: "Delete" });
      await settle();
    });
    expect(shell.uiStateStore.getState().imageLoadFailures.size).toBe(0);
  });
});

describe("file drop", () => {
  const overlayText = "ここに画像をドロップ";

  it("shows the drop hint only while files are dragged over the window", async () => {
    const { shell } = await renderWithImages();
    expect(screen.queryByText(overlayText)).toBeNull();
    act(() => shell.dropEventSource.emitDragState({ active: true }));
    expect(screen.getByText(overlayText)).toBeTruthy();
    expect(
      screen.getByTestId("canvas-drop-overlay").getAttribute("aria-hidden"),
    ).toBe("true");
    act(() => shell.dropEventSource.emitDragState({ active: false }));
    expect(screen.queryByText(overlayText)).toBeNull();
  });

  it("creates image blocks for a dropped file", async () => {
    const { shell } = await renderWithImages();
    shell.gateway.scriptDrop("drop-1", [
      {
        fileName: "new.png",
        naturalWidth: 640,
        naturalHeight: 480,
        initialWidth: 160,
        initialHeight: 120,
      },
    ]);
    await act(async () => {
      shell.dropEventSource.emitFilesDropped({
        dropId: "drop-1",
        fileCount: 1,
      });
      await settle();
    });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(6);
    const created = options[5] as HTMLElement;
    expect(imageOf(created).getAttribute("src")).toContain("assets/new.png");
    expect(created.getAttribute("aria-selected")).toBe("true");
  });

  it("answers a drop with an error when no sheet is shown", async () => {
    // Subscribed by the shell itself, not by a canvas.
    const { shell } = await renderWithImages();
    await act(async () => {
      await shell.actions.createDocument("Empty");
      await settle();
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    act(() => {
      shell.dropEventSource.emitFilesDropped({ dropId: "x", fileCount: 1 });
    });
    await act(settle);
    expect(
      shell.uiStateStore
        .getState()
        .operationErrors.map((entry) => entry.operation),
    ).toEqual(["importImagesWithoutSheet"]);
    expect(
      screen.getByText(/画像を追加するにはSheetを開いてください/),
    ).toBeTruthy();
  });

  it("stops listening when the shell unmounts", async () => {
    const { shell } = await renderWithImages();
    expect(shell.dropEventSource.listenerCount()).toBe(2);
    cleanup();
    expect(shell.dropEventSource.listenerCount()).toBe(0);
  });
});
