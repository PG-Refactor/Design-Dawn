// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { settle } from "../../application/test-support/fakes";
import {
  blockOption,
  canvasElement,
  renderOpenedCanvas,
} from "../markdown/test-support/markdown-harness";

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

const frameOf = (option: HTMLElement) => option.parentElement as HTMLElement;
const resizeHandle = (index: number) =>
  screen.getAllByRole("button", { name: /のサイズを変更/ })[
    index
  ] as HTMLElement;

function select(...indexes: number[]) {
  indexes.forEach((index, order) => {
    fireEvent.pointerDown(
      blockOption(index),
      pointer(5, 5, order === 0 ? {} : { shiftKey: true }),
    );
    fireEvent.pointerUp(canvasElement(), pointer(5, 5));
  });
}

async function release(x: number, y: number) {
  await act(async () => {
    fireEvent.pointerUp(canvasElement(), pointer(x, y));
    await settle();
  });
}

describe("grid snap of a move", () => {
  it("shows the snapped preview and commits exactly that with one entry", async () => {
    const { canvas } = await renderOpenedCanvas();
    fireEvent.pointerDown(blockOption(0), pointer(100, 100));
    fireEvent.pointerMove(canvasElement(), pointer(130, 110));
    // (10, 20) + (30, 10) = (40, 30) -> (48, 24).
    expect(frameOf(blockOption(0)).style.left).toBe("48px");
    expect(frameOf(blockOption(0)).style.top).toBe("24px");
    await release(130, 110);
    expect(canvas.blocksOfSheetA1()[0]?.position).toEqual({ x: 48, y: 24 });
    expect(await canvas.undoDepth()).toBe(1);
  });

  it("keeps the relative positions of a multi-selection", async () => {
    const { canvas } = await renderOpenedCanvas();
    select(0, 2);
    fireEvent.pointerDown(blockOption(0), pointer(100, 100));
    fireEvent.pointerMove(canvasElement(), pointer(115, 115));
    await release(115, 115);
    const [first, , third] = canvas.blocksOfSheetA1();
    expect(first?.position).toEqual({ x: 34, y: 24 });
    expect(third?.position).toEqual({ x: 24, y: 204 });
    expect(await canvas.undoDepth()).toBe(1);
  });

  it("is unsnapped while Alt is held on the pointer event", async () => {
    const { canvas } = await renderOpenedCanvas();
    fireEvent.pointerDown(blockOption(0), pointer(100, 100));
    fireEvent.pointerMove(canvasElement(), pointer(130, 110, { altKey: true }));
    expect(frameOf(blockOption(0)).style.left).toBe("40px");
    await release(130, 110);
    expect(canvas.blocksOfSheetA1()[0]?.position).toEqual({ x: 40, y: 30 });
  });

  it("switches with the Alt key mid-drag and re-snaps on release of Alt", async () => {
    const { canvas } = await renderOpenedCanvas();
    fireEvent.pointerDown(blockOption(0), pointer(100, 100));
    fireEvent.pointerMove(canvasElement(), pointer(130, 110));
    expect(frameOf(blockOption(0)).style.left).toBe("48px");

    expect(
      fireEvent.keyDown(canvasElement(), { key: "Alt", altKey: true }),
    ).toBe(false);
    expect(frameOf(blockOption(0)).style.left).toBe("40px");
    expect(frameOf(blockOption(0)).style.top).toBe("30px");

    expect(fireEvent.keyUp(canvasElement(), { key: "Alt" })).toBe(false);
    expect(frameOf(blockOption(0)).style.left).toBe("48px");
    expect(canvas.session.getState().history.canUndo).toBe(false);

    await release(130, 110);
    expect(canvas.blocksOfSheetA1()[0]?.position).toEqual({ x: 48, y: 24 });
    expect(await canvas.undoDepth()).toBe(1);
  });

  it("leaves Alt alone outside a gesture and inside an input", async () => {
    await renderOpenedCanvas();
    expect(fireEvent.keyDown(canvasElement(), { key: "Alt" })).toBe(true);
    const input = document.createElement("input");
    canvasElement().appendChild(input);
    fireEvent.pointerDown(blockOption(0), pointer(100, 100));
    fireEvent.pointerMove(canvasElement(), pointer(130, 110));
    expect(fireEvent.keyDown(input, { key: "Alt" })).toBe(true);
    expect(frameOf(blockOption(0)).style.left).toBe("48px");
    await release(130, 110);
  });
});

describe("grid snap of a resize", () => {
  it("previews the snapped size and commits it with one entry", async () => {
    const { canvas } = await renderOpenedCanvas();
    fireEvent.pointerDown(resizeHandle(0), pointer(0, 0));
    fireEvent.pointerMove(canvasElement(), pointer(40, 25));
    expect(frameOf(blockOption(0)).style.width).toBe("134px");
    expect(frameOf(blockOption(0)).style.height).toBe("76px");
    await release(40, 25);
    expect(canvas.blocksOfSheetA1()[0]?.size).toEqual({
      width: 134,
      height: 76,
    });
    expect(canvas.blocksOfSheetA1()[0]?.position).toEqual({ x: 10, y: 20 });
    expect(await canvas.undoDepth()).toBe(1);
  });

  it("is unsnapped with Alt", async () => {
    await renderOpenedCanvas();
    fireEvent.pointerDown(resizeHandle(0), pointer(0, 0));
    fireEvent.pointerMove(canvasElement(), pointer(40, 25, { altKey: true }));
    expect(frameOf(blockOption(0)).style.width).toBe("140px");
    await release(40, 25);
  });
});

describe("align menu", () => {
  const alignButton = () => screen.getByRole("button", { name: "整列" });
  const openMenu = async (user: {
    click: (element: Element) => Promise<void>;
  }) => {
    await user.click(alignButton());
    return screen.getByRole("menu", { name: "Blockの整列" });
  };

  it("lists the six operations around one separator", async () => {
    const { shell } = await renderOpenedCanvas();
    const menu = await openMenu(shell.user);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "左揃え",
      "左右中央揃え",
      "右揃え",
      "上揃え",
      "上下中央揃え",
      "下揃え",
    ]);
    expect(within(menu).getAllByRole("separator")).toHaveLength(1);
  });

  it("is disabled with fewer than two blocks selected and enabled from two", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    let menu = await openMenu(shell.user);
    for (const item of within(menu).getAllByRole("menuitem")) {
      expect(item.getAttribute("aria-disabled")).toBe("true");
    }
    await shell.user.click(
      within(menu).getByRole("menuitem", { name: "左揃え" }),
    );
    expect(canvas.session.getState().history.canUndo).toBe(false);

    select(0);
    menu = await openMenu(shell.user);
    expect(
      within(menu)
        .getByRole("menuitem", { name: "左揃え" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    await shell.user.click(document.body);

    select(0, 1);
    menu = await openMenu(shell.user);
    for (const item of within(menu).getAllByRole("menuitem")) {
      expect(item.getAttribute("aria-disabled")).toBeNull();
    }
  });

  // Selected blocks 1 (10,20) and 2 (300,40), both 100 x 50: box x 10..400, y 20..90.
  it.each([
    ["左揃え", [10, 20], [10, 40]],
    ["左右中央揃え", [155, 20], [155, 40]],
    ["右揃え", [300, 20], [300, 40]],
    ["上揃え", [10, 20], [300, 20]],
    ["上下中央揃え", [10, 30], [300, 30]],
    ["下揃え", [10, 40], [300, 40]],
  ])(
    "%s moves the blocks as expected in one entry",
    async (label, first, second) => {
      const { shell, canvas } = await renderOpenedCanvas();
      select(0, 1);
      const menu = await openMenu(shell.user);
      await shell.user.click(
        within(menu).getByRole("menuitem", { name: label }),
      );
      await act(settle);
      const [one, two] = canvas.blocksOfSheetA1();
      expect([one?.position.x, one?.position.y]).toEqual(first);
      expect([two?.position.x, two?.position.y]).toEqual(second);
      expect(canvas.session.getState().history.undoLabel).toBe("moveBlocks");
      expect(await canvas.undoDepth()).toBe(1);
    },
  );
});
